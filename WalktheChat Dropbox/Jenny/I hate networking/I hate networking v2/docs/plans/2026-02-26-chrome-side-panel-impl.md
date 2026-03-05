# Chrome Side Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current popup + Luma content-script panel with a single Chrome Side Panel that shows a landing page, campaign status, and scan flow from any browser tab.

**Architecture:** The side panel (`sidepanel/sidepanel.html`) is a persistent extension page (not injected into pages). It reads state from `chrome.storage.local` and message-passes with content scripts. DOM scraping stays in `luma.ts` (content script). The service worker is unchanged except removing the `onClicked` listener.

**Tech Stack:** TypeScript + esbuild, Chrome Side Panel API (chrome.sidePanel), chrome.storage, chrome.runtime messaging. No new dependencies.

---

## Reference: Key Existing Files

- `extension/background/service-worker.ts` — queue processing, Supabase, message handlers
- `extension/content/panel.ts` — **being replaced**: has all render logic + DOM scraping helpers to copy from
- `extension/content/luma.ts` — content script for Luma pages, will add scan message handler
- `extension/manifest.json` — update permissions + add side_panel key
- `extension/package.json` — update build script
- Storage keys used: `queuePending`, `campaignPaused`, `nextScheduledAt`, `lastSentAt`, `lastSentName`

## Build Command (run from `extension/` directory)

```bash
npm run build
```

To load: Chrome → chrome://extensions → Load unpacked → select `extension/` folder → reload after each build.

---

### Task 1: Manifest + build scaffolding

**Files:**
- Modify: `extension/manifest.json`
- Modify: `extension/package.json`

**Step 1: Update manifest.json**

Replace the entire file with this (adds `sidePanel` permission, `side_panel` key, removes `popup/popup.html` reference if present — it wasn't in the action already):

```json
{
  "manifest_version": 3,
  "name": "I Hate Networking",
  "version": "1.0.0",
  "description": "Connect with Luma event attendees on LinkedIn",
  "permissions": ["storage", "tabs", "alarms", "activeTab", "cookies", "sidePanel"],
  "host_permissions": [
    "https://lu.ma/*",
    "https://*.lu.ma/*",
    "https://luma.com/*",
    "https://www.linkedin.com/*",
    "https://*.supabase.co/*"
  ],
  "background": {
    "service_worker": "dist/service-worker.js",
    "type": "module"
  },
  "content_scripts": [
    {
      "matches": ["https://lu.ma/*", "https://*.lu.ma/*", "https://luma.com/*"],
      "js": ["dist/luma.js"],
      "run_at": "document_idle"
    },
    {
      "matches": ["https://www.linkedin.com/in/*"],
      "js": ["dist/linkedin.js"],
      "run_at": "document_idle"
    }
  ],
  "icons": {
    "16": "icons/icon16.png",
    "32": "icons/icon32.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png"
  },
  "action": {
    "default_title": "I Hate Networking",
    "default_icon": {
      "16": "icons/icon16.png",
      "32": "icons/icon32.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png"
    }
  },
  "side_panel": {
    "default_path": "sidepanel/sidepanel.html"
  },
  "externally_connectable": {
    "matches": ["https://*.vercel.app/*"]
  }
}
```

Note: `panel.js` and `panel.css` content scripts are REMOVED here. This means panel.ts functionality stops working until Task 6 completes. Keep panel.ts source files until Task 8.

**Step 2: Update build script in package.json**

Replace the `"build"` script line only:

```json
"build": "npx esbuild background/service-worker.ts --bundle --outfile=dist/service-worker.js --platform=browser --target=chrome120 && npx esbuild content/luma.ts --bundle --outfile=dist/luma.js --platform=browser --target=chrome120 && npx esbuild content/linkedin.ts --bundle --outfile=dist/linkedin.js --platform=browser --target=chrome120 && npx esbuild sidepanel/sidepanel.ts --bundle --outfile=dist/sidepanel.js --platform=browser --target=chrome120 && cp sidepanel/sidepanel.css dist/sidepanel.css"
```

**Step 3: Create the sidepanel directory**

```bash
mkdir -p extension/sidepanel
```

**Step 4: Create sidepanel/sidepanel.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@300;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="../dist/sidepanel.css">
</head>
<body>
  <div id="root"></div>
  <script src="../dist/sidepanel.js"></script>
</body>
</html>
```

**Step 5: Create empty placeholder files so build doesn't fail**

Create `extension/sidepanel/sidepanel.css` (empty for now) and `extension/sidepanel/sidepanel.ts`:

```typescript
// sidepanel.ts — placeholder
document.getElementById('root')!.textContent = 'Loading...'
```

**Step 6: Build and verify**

```bash
cd extension && npm run build
```

Expected: build succeeds, `dist/sidepanel.js` and `dist/sidepanel.css` created.

**Step 7: Reload extension in Chrome and verify side panel opens**

Click the extension icon — a side panel should open on the right showing "Loading...". No new tabs should open.

**Step 8: Commit**

```bash
git add extension/manifest.json extension/package.json extension/sidepanel/
git commit -m "feat: scaffold Chrome Side Panel — manifest, build, HTML shell"
```

---

### Task 2: Side panel CSS

**Files:**
- Write: `extension/sidepanel/sidepanel.css`

Create the complete CSS. The side panel is its own document — no `#ihn-` prefix namespacing needed.

```css
/* ── Reset + base ── */
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 14px;
  color: #111827;
  background: #fff;
  min-height: 100vh;
}

/* ── Hero header (landing state) ── */
.hero {
  background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
  padding: 28px 20px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 8px;
}
.hero-logo { width: 64px; height: 64px; object-fit: contain; }
.hero-name {
  font-family: 'Montserrat', sans-serif;
  font-size: 16px; font-weight: 700;
  color: #fff;
  margin-top: 4px;
}
.hero-sub {
  font-family: 'Montserrat', sans-serif;
  font-size: 11px; font-weight: 300;
  color: rgba(255,255,255,0.6);
}

/* ── Compact header (campaign state) ── */
.compact-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #f3f4f6;
}
.compact-brand { display: flex; align-items: center; gap: 8px; }
.compact-logo { width: 24px; height: 24px; object-fit: contain; }
.compact-name {
  font-family: 'Montserrat', sans-serif;
  font-size: 12px; font-weight: 700;
  color: #1a2340;
}

/* ── Status pill ── */
.status-pill {
  display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 10px 3px 8px;
  border-radius: 99px;
  font-size: 11px; font-weight: 600;
}
.status-pill .dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.pill-running { background: #f0fdf4; color: #16a34a; }
.pill-running .dot { background: #22c55e; animation: pulse-dot 1.8s infinite; }
.pill-paused { background: #fef3c7; color: #b45309; }
.pill-paused .dot { background: #f59e0b; }
@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* ── Body sections ── */
.section { padding: 16px; border-bottom: 1px solid #f3f4f6; }
.section:last-child { border-bottom: none; }

/* ── Landing tagline ── */
.tagline {
  font-size: 15px; font-weight: 600; color: #111827;
  line-height: 1.4;
  padding: 20px 20px 0;
}

/* ── Steps ── */
.steps { padding: 16px 20px; display: flex; flex-direction: column; gap: 16px; }
.step { display: flex; align-items: flex-start; gap: 12px; }
.step-num {
  width: 24px; height: 24px; border-radius: 50%;
  background: #4f46e5; color: #fff;
  font-size: 12px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; margin-top: 1px;
}
.step-text { display: flex; flex-direction: column; gap: 2px; }
.step-title { font-size: 13px; font-weight: 600; color: #111827; }
.step-desc { font-size: 12px; color: #9ca3af; line-height: 1.4; }

/* ── Divider ── */
.divider { height: 1px; background: #f3f4f6; margin: 0 16px; }

/* ── Buttons ── */
.btn {
  width: 100%; padding: 11px 14px; border: none; border-radius: 8px;
  font-size: 14px; font-weight: 600;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  cursor: pointer; transition: opacity 0.15s;
  display: flex; align-items: center; justify-content: center; gap: 6px;
}
.btn:hover { opacity: 0.82; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-secondary { background: #f9fafb; color: #374151; border: 1px solid #e5e7eb; }
.btn-wrap { padding: 16px; }

/* ── Stats cards ── */
.stats-row { display: flex; gap: 0; }
.stat-card {
  flex: 1; padding: 14px 0; text-align: center;
  border: 1px solid #f3f4f6;
}
.stat-card + .stat-card { border-left: none; }
.stat-card:first-child { border-radius: 8px 0 0 8px; }
.stat-card:last-child { border-radius: 0 8px 8px 0; }
.stat-card:only-child { border-radius: 8px; }
.stat-num { font-size: 26px; font-weight: 700; line-height: 1; color: #111827; }
.stat-num.green { color: #16a34a; }
.stat-num.red { color: #ef4444; }
.stat-label {
  font-size: 10px; font-weight: 500; color: #9ca3af;
  text-transform: uppercase; letter-spacing: 0.06em;
  margin-top: 4px;
}

/* ── Progress bar ── */
.progress-wrap { margin: 12px 0 4px; }
.progress-bg {
  background: #e5e7eb; border-radius: 99px; height: 6px; overflow: hidden;
}
.progress-fill {
  height: 100%; background: #4f46e5; border-radius: 99px;
  transition: width 0.4s ease;
}
.progress-meta {
  display: flex; justify-content: space-between;
  font-size: 11px; color: #9ca3af; margin-top: 5px;
}

/* ── Pause toggle ── */
.pause-row { margin-top: 12px; }

/* ── Activity feed ── */
.feed-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 10px;
}
.feed-title {
  font-size: 10px; font-weight: 600; color: #9ca3af;
  text-transform: uppercase; letter-spacing: 0.06em;
}
.feed-list { display: flex; flex-direction: column; gap: 0; }
.feed-row {
  display: flex; align-items: center; gap: 10px;
  padding: 9px 0;
  border-bottom: 1px solid #f9fafb;
}
.feed-row:last-child { border-bottom: none; }
.feed-avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: #e0e7ff; color: #4f46e5;
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.feed-info { flex: 1; min-width: 0; }
.feed-name { font-size: 13px; font-weight: 500; color: #111827; }
.feed-meta { font-size: 11px; color: #9ca3af; margin-top: 1px; }
.feed-event-tag {
  font-size: 10px; font-weight: 500;
  background: #e0e7ff; color: #4f46e5;
  padding: 2px 7px; border-radius: 99px;
  white-space: nowrap; flex-shrink: 0;
  max-width: 110px; overflow: hidden; text-overflow: ellipsis;
}

/* ── Scan state (event page) ── */
.event-hero { padding: 20px 16px 0; }
.event-name { font-size: 16px; font-weight: 700; color: #111827; line-height: 1.3; }
.event-meta { font-size: 12px; color: #9ca3af; margin-top: 4px; }
.event-guests { font-size: 13px; color: #6366f1; font-weight: 600; margin-top: 8px; }

/* ── Scanning progress ── */
.scanning-label { font-size: 13px; color: #6b7280; margin-bottom: 10px; }
.scanning-label strong { color: #111827; }

/* ── Results ── */
.results-count { font-size: 22px; font-weight: 700; color: #4f46e5; }
.results-sub { font-size: 13px; color: #6b7280; margin: 2px 0 16px; }
.leads-list {
  max-height: 220px; overflow-y: auto;
  border: 1px solid #e5e7eb; border-radius: 8px;
  margin-bottom: 16px;
}
.lead-row {
  display: flex; align-items: center; gap: 8px;
  padding: 7px 10px; border-bottom: 1px solid #f3f4f6;
}
.lead-row:last-child { border-bottom: none; }
.lead-initials {
  width: 28px; height: 28px; border-radius: 50%;
  background: #e0e7ff; color: #4f46e5;
  font-size: 11px; font-weight: 700;
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.lead-name { flex: 1; font-size: 13px; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lead-badges { display: flex; gap: 4px; flex-shrink: 0; }
.badge {
  padding: 2px 6px; border-radius: 4px;
  font-size: 10px; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em;
  text-decoration: none;
}
.badge-li { background: #dbeafe; color: #1e40af; }
.badge-ig { background: #fce7f3; color: #9d174d; }
.badge-x  { background: #f3f4f6; color: #111827; }
.badge-web { background: #d1fae5; color: #065f46; }

/* ── Note textarea + launch ── */
.field-label {
  font-size: 12px; font-weight: 600; color: #374151;
  display: flex; justify-content: space-between; margin-bottom: 6px;
}
.char-count { font-weight: 400; color: #9ca3af; }
textarea {
  width: 100%; box-sizing: border-box;
  border: 1px solid #d1d5db; border-radius: 8px;
  padding: 10px 12px; font-size: 13px;
  font-family: inherit; resize: vertical; min-height: 88px;
  color: #111827; outline: none;
  transition: border-color 0.15s;
}
textarea:focus { border-color: #4f46e5; }

/* ── LinkedIn status banner ── */
.li-status {
  margin: 12px 0; padding: 10px 12px;
  border-radius: 8px; font-size: 13px;
  display: flex; align-items: center; gap: 8px;
}
.li-status.warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
.li-status.ok   { background: #f0fdf4; border: 1px solid #86efac; color: #166534; }
.li-open { margin-left: auto; color: #4f46e5; text-decoration: none; font-weight: 600; font-size: 12px; }

/* ── Auth / login gate ── */
.auth-gate { display: flex; flex-direction: column; gap: 8px; margin-top: 12px; }
.auth-label { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 2px; }
input[type="email"], input[type="password"] {
  width: 100%; box-sizing: border-box;
  border: 1px solid #d1d5db; border-radius: 8px;
  padding: 9px 12px; font-size: 13px;
  font-family: inherit; color: #111827; outline: none;
  transition: border-color 0.15s;
}
input:focus { border-color: #4f46e5; }
.auth-error { font-size: 12px; color: #dc2626; min-height: 16px; }
.auth-toggle { font-size: 12px; color: #6b7280; text-align: center; }
.auth-toggle-btn {
  background: none; border: none; color: #4f46e5;
  font-size: 12px; font-weight: 600; cursor: pointer;
  padding: 0; font-family: inherit; text-decoration: underline;
}

/* ── Launched confirmation ── */
.launched-icon { font-size: 36px; margin-bottom: 8px; }
.launched-title { font-size: 18px; font-weight: 700; margin-bottom: 4px; }
.launched-sub { font-size: 13px; color: #6b7280; margin-bottom: 16px; line-height: 1.5; }
.launched-note { font-size: 12px; color: #9ca3af; margin-bottom: 24px; line-height: 1.5; }

/* ── Progress/stats view ── */
.chart-wrap { margin: 8px 0 4px; }
.chart-empty { font-size: 12px; color: #9ca3af; text-align: center; padding: 16px 0; }
.events-list { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; }
.event-row { border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden; }
.event-row-header {
  display: flex; align-items: center; gap: 6px;
  padding: 8px 10px; cursor: pointer; background: #f9fafb;
}
.event-row-header:hover { background: #f3f4f6; }
.event-row-name { flex: 1; font-size: 13px; font-weight: 500; color: #111827; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.event-row-badge { font-size: 11px; color: #6b7280; background: #e5e7eb; padding: 1px 6px; border-radius: 10px; flex-shrink: 0; }
.event-row-badge.queued { color: #4f46e5; background: #e0e7ff; }
.event-row-badge.paused { color: #b45309; background: #fef3c7; }
.event-row-pause-btn {
  background: none; border: none; cursor: pointer;
  font-size: 11px; color: #9ca3af; padding: 0 0 0 4px;
  margin-left: auto; flex-shrink: 0; font-family: inherit;
}
.event-row-pause-btn:hover { color: #4f46e5; }
.event-contacts { padding: 4px 10px 8px; display: flex; flex-direction: column; gap: 4px; }
.contact-row { display: flex; align-items: center; justify-content: space-between; }
.contact-name { font-size: 12px; color: #374151; }
.status-badge { font-size: 10px; padding: 1px 6px; border-radius: 8px; font-weight: 500; }
.status-badge.pending  { background: #f3f4f6; color: #6b7280; }
.status-badge.sent     { background: #dbeafe; color: #1d4ed8; }
.status-badge.accepted { background: #dcfce7; color: #16a34a; }
.status-badge.failed   { background: #fee2e2; color: #dc2626; }

/* ── Already scanned ── */
.already-count { font-size: 13px; color: #6366f1; margin-bottom: 4px; }

/* ── Byline ── */
.byline { font-size: 11px; color: #d1d5db; text-align: center; padding: 12px 16px 16px; }
.byline a { color: #d1d5db; text-decoration: none; }
.byline a:hover { color: #9ca3af; }

/* ── Utility ── */
.text-muted { font-size: 12px; color: #9ca3af; }
.mt-4 { margin-top: 4px; }
.mt-8 { margin-top: 8px; }
.mt-12 { margin-top: 12px; }
```

**Step 2: Build and verify CSS loads**

```bash
cd extension && npm run build
```

Reload extension, open side panel — "Loading..." text should now use the correct font.

**Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.css
git commit -m "feat: add side panel CSS design system"
```

---

### Task 3: Side panel — state detection + landing page

**Files:**
- Write: `extension/sidepanel/sidepanel.ts`

The side panel needs to know: (1) is there a campaign running? (2) what page is the active tab on? Then it renders the right state.

**Step 1: Replace sidepanel.ts with full implementation**

```typescript
import { icons } from '../lib/icons'

// ── Types ─────────────────────────────────────────────────────────────────────

type TabContext =
  | { kind: 'luma-event'; tabId: number; eventName: string }
  | { kind: 'luma-other'; tabId: number }
  | { kind: 'other' }

type AppState =
  | { type: 'loading' }
  | { type: 'landing'; ctx: TabContext }
  | { type: 'campaign'; pending: number; paused: boolean; ctx: TabContext }

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase()
}

const nonEventPaths = ['', '/', '/home', '/calendar', '/events', '/discover', '/explore', '/settings', '/dashboard']

function isLumaEventPath(pathname: string): boolean {
  return !nonEventPaths.includes(pathname) && pathname.split('/').length === 2
}

// ── State resolution ──────────────────────────────────────────────────────────

async function resolveTabContext(): Promise<TabContext> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab?.url || !tab.id) return { kind: 'other' }
  const tabId = tab.id
  const url = tab.url
  const isLuma = url.includes('lu.ma') || url.includes('luma.com')
  if (!isLuma) return { kind: 'other' }
  const pathname = (() => { try { return new URL(url).pathname } catch { return '' } })()
  if (!isLumaEventPath(pathname)) return { kind: 'luma-other', tabId }
  // On event page — try to get event name from page title via tab
  const eventName = tab.title?.replace(/\s*[·|–-].*$/, '').trim() ?? ''
  return { kind: 'luma-event', tabId, eventName }
}

async function resolveAppState(): Promise<AppState> {
  const [ctx, storage] = await Promise.all([
    resolveTabContext(),
    chrome.storage.local.get(['queuePending', 'campaignPaused']),
  ])
  const pending: number = storage.queuePending ?? 0
  const paused: boolean = storage.campaignPaused ?? false
  if (pending > 0 || paused) {
    return { type: 'campaign', pending, paused, ctx }
  }
  return { type: 'landing', ctx }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

const root = document.getElementById('root')!

function renderLoading(): void {
  root.innerHTML = `<div style="padding:40px 20px;text-align:center;color:#9ca3af;font-size:13px;">Loading…</div>`
}

function renderLanding(ctx: TabContext): void {
  const ctaLabel = ctx.kind === 'luma-other'
    ? 'Browse Luma events →'
    : 'Open Luma.com →'
  const ctaHref = ctx.kind === 'luma-other'
    ? 'https://lu.ma/events'
    : 'https://lu.ma'
  const step1desc = ctx.kind === 'luma-other'
    ? 'Open a specific event page on Luma'
    : 'Open any event you attended on lu.ma'

  root.innerHTML = `
    <div class="hero">
      <img src="../icons/icon48.png" class="hero-logo" alt="">
      <div class="hero-name">I Hate Networking</div>
      <div class="hero-sub">networking, automated</div>
    </div>

    <p class="tagline">Event follow-up shouldn't be your second job.</p>

    <div class="divider" style="margin-top:16px;"></div>

    <div class="steps">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-text">
          <div class="step-title">Go to a Luma event page</div>
          <div class="step-desc">${step1desc}</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-text">
          <div class="step-title">Scan the guest list</div>
          <div class="step-desc">We find everyone's LinkedIn profile</div>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-text">
          <div class="step-title">Connections send automatically</div>
          <div class="step-desc">35/day max · business hours only · keeps your account safe</div>
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <div class="btn-wrap">
      <button class="btn btn-primary" id="btnCta">${ctaLabel}</button>
    </div>

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
  `

  document.getElementById('btnCta')!.addEventListener('click', () => {
    chrome.tabs.create({ url: ctaHref })
  })
}

// ── Campaign state — placeholder (Task 4) ────────────────────────────────────

function renderCampaign(state: Extract<AppState, { type: 'campaign' }>): void {
  root.innerHTML = `<div style="padding:20px;color:#9ca3af;font-size:13px;">Campaign view coming in Task 4…</div>`
}

// ── Main init + tab change listener ──────────────────────────────────────────

async function render(): Promise<void> {
  renderLoading()
  const state = await resolveAppState()
  if (state.type === 'landing') {
    renderLanding(state.ctx)
  } else if (state.type === 'campaign') {
    renderCampaign(state)
  }
}

// Re-render when user navigates to a different tab
chrome.tabs.onActivated.addListener(() => render())

// Re-render when the active tab's URL changes
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) render()
})

// Re-render when storage changes (campaign starts/stops/pauses)
chrome.storage.onChanged.addListener(() => render())

render()
```

**Step 2: Build**

```bash
cd extension && npm run build
```

**Step 3: Test**

Reload extension. Open side panel on a non-Luma tab → should show landing page with gradient header, 3 steps, "Open Luma.com →" button. Navigate to lu.ma (homepage) → should show "Open a specific event page" variant. Click the CTA → new tab opens to lu.ma. Correct.

**Step 4: Commit**

```bash
git add extension/sidepanel/sidepanel.ts
git commit -m "feat: side panel landing page state"
```

---

### Task 4: Side panel — campaign running state

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts`

**Step 1: Replace the `renderCampaign` placeholder with full implementation**

Find the `renderCampaign` placeholder function and replace it:

```typescript
function nextConnectionLabel(nextAt: string | null): string {
  if (!nextAt) return ''
  const diff = new Date(nextAt).getTime() - Date.now()
  if (diff <= 0) return 'Next connection starting soon'
  const mins = Math.ceil(diff / 60000)
  return `Next connection in ~${mins} min`
}

async function renderCampaign(state: Extract<AppState, { type: 'campaign' }>): Promise<void> {
  // Fetch full progress data for activity feed
  const [progressResp, storageData] = await Promise.all([
    new Promise<any>(r => chrome.runtime.sendMessage({ type: 'GET_PROGRESS_DATA' }, r)),
    chrome.storage.local.get(['nextScheduledAt']),
  ])

  const events: any[] = progressResp?.events ?? []
  const nextAt: string | null = storageData.nextScheduledAt ?? null

  // Tally stats + build activity list
  let sent = 0, pending = 0, failed = 0
  const recentActivity: { name: string; eventName: string }[] = []

  for (const event of events) {
    for (const contact of event.contacts ?? []) {
      const status = contact.connection_queue?.[0]?.status
      if (status === 'sent' || status === 'accepted') {
        sent++
        recentActivity.push({ name: contact.name ?? '', eventName: event.name ?? '' })
      } else if (status === 'pending') {
        pending++
      } else if (status === 'failed') {
        failed++
      }
    }
  }

  const total = sent + pending + failed
  const pct = total > 0 ? Math.round((sent / total) * 100) : 0
  const isRunning = pending > 0 && !state.paused

  const statusHtml = isRunning
    ? `<span class="status-pill pill-running"><span class="dot"></span>Running</span>`
    : state.paused
    ? `<span class="status-pill pill-paused"><span class="dot"></span>Paused</span>`
    : `<span class="status-pill" style="background:#f3f4f6;color:#6b7280"><span class="dot" style="background:#d1d5db"></span>Done</span>`

  const statsHtml = `
    <div class="stats-row" style="margin:0 16px;">
      <div class="stat-card">
        <div class="stat-num green">${sent}</div>
        <div class="stat-label">Connected</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${pending}</div>
        <div class="stat-label">Queued</div>
      </div>
      ${failed > 0 ? `
      <div class="stat-card">
        <div class="stat-num red">${failed}</div>
        <div class="stat-label">Skipped</div>
      </div>` : ''}
    </div>
  `

  const progressHtml = total > 0 ? `
    <div style="padding:0 16px;">
      <div class="progress-wrap">
        <div class="progress-bg">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="progress-meta">
          <span>${pct}% complete</span>
          <span>${nextConnectionLabel(isRunning ? nextAt : null)}</span>
        </div>
      </div>
    </div>
  ` : ''

  const pauseBtnLabel = isRunning ? '⏸ Pause campaign' : '▶ Resume campaign'
  const pauseBtnId = isRunning ? 'btnPause' : 'btnResume'

  const activityHtml = recentActivity.length > 0 ? `
    <div class="section">
      <div class="feed-header">
        <span class="feed-title">Recently Connected</span>
      </div>
      <div class="feed-list">
        ${recentActivity.map(a => `
          <div class="feed-row">
            <div class="feed-avatar">${escHtml(initials(a.name))}</div>
            <div class="feed-info">
              <div class="feed-name">${escHtml(a.name)}</div>
            </div>
            <span class="feed-event-tag" title="${escHtml(a.eventName)}">${escHtml(a.eventName)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  ` : ''

  const scanCta = state.ctx.kind === 'luma-event' ? `
    <div class="section">
      <button class="btn btn-primary" id="btnScan">Scan this event's guest list</button>
    </div>
  ` : `
    <div class="section">
      <button class="btn btn-secondary" id="btnScanAnother">+ Scan another event</button>
    </div>
  `

  root.innerHTML = `
    <div class="compact-header">
      <div class="compact-brand">
        <img src="../icons/icon48.png" class="compact-logo" alt="">
        <span class="compact-name">I Hate Networking</span>
      </div>
      ${statusHtml}
    </div>

    <div class="section">
      ${statsHtml}
      ${progressHtml}
      ${pending > 0 ? `<div class="pause-row"><button class="btn btn-secondary" id="${pauseBtnId}">${pauseBtnLabel}</button></div>` : ''}
    </div>

    ${activityHtml}
    ${scanCta}

    <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
  `

  document.getElementById('btnPause')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'PAUSE_CAMPAIGN' }, () => render())
  })
  document.getElementById('btnResume')?.addEventListener('click', () => {
    chrome.runtime.sendMessage({ type: 'RESUME_CAMPAIGN' }, () => render())
  })
  document.getElementById('btnScanAnother')?.addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://lu.ma' })
  })
  // btnScan wired up in Task 6 when scan flow is ready
}
```

Also update the `render()` function to call the async `renderCampaign`:

```typescript
async function render(): Promise<void> {
  renderLoading()
  const state = await resolveAppState()
  if (state.type === 'landing') {
    renderLanding(state.ctx)
  } else if (state.type === 'campaign') {
    await renderCampaign(state)
  }
}
```

**Step 2: Build + test**

```bash
cd extension && npm run build
```

Reload extension. If a campaign is running: open side panel from any page → should show compact header, 3 stat cards, progress bar, pause button, and activity feed with event tags. Pause/resume should toggle.

If no campaign: confirms landing page still shows.

**Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts
git commit -m "feat: side panel campaign running state — stats, progress, activity feed"
```

---

### Task 5: Refactor luma.ts to expose scan via messages

The DOM scraping logic lives in `panel.ts` currently. We need to move it to `luma.ts` so the side panel can trigger a scan on a Luma event tab.

**Files:**
- Modify: `extension/content/luma.ts`

**Step 1: Add DOM scraping helpers to luma.ts**

These functions already exist verbatim in `panel.ts` (lines 7-103 of the cached output). Copy them into `luma.ts` before the existing message listener:

```typescript
// ── DOM scraping helpers ────────────────────────────────────────────────────

function parseGuestLinksFromDoc(doc: Document): string[] {
  const selectors = ["a[href*='/u/']", "a[href*='/user/']"]
  const seen = new Set<string>()
  const links: string[] = []
  for (const sel of selectors) {
    doc.querySelectorAll<HTMLAnchorElement>(sel).forEach(a => {
      const href = a.href || a.getAttribute('href') || ''
      if (href && !seen.has(href)) { seen.add(href); links.push(href) }
    })
  }
  return links
}

function extractHostProfileUrlsFromDoc(doc: Document): string[] {
  const hostSections = doc.querySelectorAll('[class*="organizer"], [class*="host"]')
  const seen = new Set<string>()
  const urls: string[] = []
  hostSections.forEach(section => {
    section.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']").forEach(a => {
      const href = a.href || a.getAttribute('href') || ''
      if (href && !seen.has(href)) { seen.add(href); urls.push(href) }
    })
  })
  return urls
}

async function scrollToLoadAll(container: Element | null, maxIter = 15): Promise<void> {
  if (!container) return
  let prevHeight = 0
  for (let i = 0; i < maxIter; i++) {
    (container as HTMLElement).scrollTop += 600
    await new Promise(r => setTimeout(r, 500))
    if (container.scrollHeight === prevHeight) break
    prevHeight = container.scrollHeight
  }
}

function findModalScrollable(preClickLinks: Set<string>): Element | null {
  const allLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href*='/u/'], a[href*='/user/']"))
  const newLinks = allLinks.filter(a => {
    const href = a.href || a.getAttribute('href') || ''
    return href && !preClickLinks.has(href)
  })
  if (newLinks.length === 0) return null
  let el: Element | null = newLinks[0].parentElement
  while (el && el !== document.documentElement) {
    const s = getComputedStyle(el)
    if ((s.overflow === 'auto' || s.overflow === 'scroll' || s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 10) return el
    el = el.parentElement
  }
  return null
}

function extractLinkedInUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?linkedin\.com\/(?:in|pub)\/[^"?#]+)[^"]*"/)
  return match ? match[1] : ''
}

function extractInstagramUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?instagram\.com\/[^"?#/][^"?#]*)[^"]*"/)
  return match ? match[1] : ''
}

function extractTwitterUrlFromHtml(html: string): string {
  const match = html.match(/href="(https:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/[^"?#/][^"?#]*)[^"]*"/)
  return match ? match[1] : ''
}

function extractWebsiteUrlFromHtml(html: string): string {
  const skip = /linkedin\.com|instagram\.com|twitter\.com|x\.com|lu\.ma|luma\.co/
  const matches = html.matchAll(/href="(https?:\/\/[^"]+)"[^>]*target="_blank"/g)
  for (const m of matches) { if (!skip.test(m[1])) return m[1] }
  return ''
}

function extractDisplayNameFromHtml(html: string): string {
  const titleMatch = html.match(/<title>\s*([^|<\n]+?)\s*(?:\||<)/)
  const raw = titleMatch ? titleMatch[1].trim()
            : (html.match(/property="og:title"\s+content="([^"]+)"/) ?? [])[1]?.trim() ?? ''
  return raw.replace(/\s*·\s*Luma\s*$/i, '').trim()
}

// ── Scan runner ──────────────────────────────────────────────────────────────

async function runScan(): Promise<void> {
  const eventName = document.querySelector('h1')?.textContent?.trim() ?? document.title
  const lumaUrl = location.href

  // Snapshot /u/ links before opening modal
  const preClickLinks = new Set(parseGuestLinksFromDoc(document))
  const labelPatterns = [/\band \d+ others\b/i, /\bGuests\b/, /\bGoing\b/, /\bAttendees\b/, /\bSee all\b/]
  const allBtns = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'))
  for (const pattern of labelPatterns) {
    const btn = allBtns.find(b => pattern.test(b.textContent ?? ''))
    if (btn) { btn.click(); break }
  }
  await new Promise(r => setTimeout(r, 2500))

  const modal = findModalScrollable(preClickLinks)
  await scrollToLoadAll(modal ?? document.scrollingElement)

  const hostProfileUrls = extractHostProfileUrlsFromDoc(document)
  const allLinks = parseGuestLinksFromDoc(document)
  const hostSet = new Set(hostProfileUrls)
  const guestProfileUrls = allLinks.filter(u => !hostSet.has(u))
  const allProfileUrls = [...hostProfileUrls, ...guestProfileUrls]

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'scraping_done', total: allProfileUrls.length, eventName, lumaUrl })

  // Enrich each profile
  let done = 0
  const contacts: { url: string; isHost: boolean; name: string; linkedInUrl: string; instagramUrl: string; twitterUrl: string; websiteUrl: string }[] = []

  for (const url of allProfileUrls) {
    const isHost = hostSet.has(url)
    try {
      const resp = await fetch(url, { credentials: 'include' })
      const html = await resp.text()
      contacts.push({
        url,
        isHost,
        name: extractDisplayNameFromHtml(html),
        linkedInUrl: extractLinkedInUrlFromHtml(html),
        instagramUrl: extractInstagramUrlFromHtml(html),
        twitterUrl: extractTwitterUrlFromHtml(html),
        websiteUrl: extractWebsiteUrlFromHtml(html),
      })
    } catch {
      contacts.push({ url, isHost, name: url.split('/').pop()?.replace(/-/g, ' ') ?? '', linkedInUrl: '', instagramUrl: '', twitterUrl: '', websiteUrl: '' })
    }
    done++
    chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'enriching', done, total: allProfileUrls.length, currentName: contacts[contacts.length-1].name })
  }

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'saving', done, total: allProfileUrls.length })

  // Save to Supabase via service worker
  const saveResult: { eventId: string; found: number; total: number } = await new Promise(resolve => {
    chrome.runtime.sendMessage({
      type: 'START_ENRICHMENT',
      data: { tabId: 0, lumaUrl, eventName, contacts }
    }, resolve)
  })

  chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', ...saveResult, contacts })
}
```

**Step 2: Add message handler for `START_SCAN` to luma.ts**

In the existing message listener in luma.ts, add a case:

```typescript
if (msg.type === 'START_SCAN') {
  runScan() // fire and forget — progress sent back via runtime.sendMessage
  sendResponse({ started: true })
  return true
}
```

**Step 3: Build + verify no errors**

```bash
cd extension && npm run build
```

No TypeScript errors expected.

**Step 4: Commit**

```bash
git add extension/content/luma.ts
git commit -m "feat: add START_SCAN handler + DOM scraping to luma.ts"
```

---

### Task 6: Side panel — event page scan flow + auth

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts`

The side panel needs to handle the full scan flow: idle on event page → scanning → results → auth/launch → launched.

**Step 1: Add ScanState type and state variables**

At the top of `sidepanel.ts` after existing types, add:

```typescript
type ScanState =
  | { type: 'idle' }
  | { type: 'already_scanned'; count: number; linkedInCount: number; eventId: string; eventName: string; noNew?: boolean }
  | { type: 'scanning'; phase: string; done: number; total: number; currentName: string; startTime: number }
  | { type: 'results'; found: number; total: number; eventId: string; eventName: string; contacts: any[] }
  | { type: 'launched'; queued: number; eventId: string }
  | { type: 'progress' }

let scanState: ScanState = { type: 'idle' }
let noteValue = ''
let authMode: 'signup' | 'signin' = 'signup'
const MAX_NOTE = 300
```

**Step 2: Add helper functions**

```typescript
function defaultNote(eventName: string): string {
  const label = eventName.split('·')[0].trim()
  return label ? `I saw you at the ${label} event, I'd like to stay in touch!`
               : "I saw you at the event, I'd like to stay in touch!"
}

function etaString(done: number, total: number, startTime: number): string {
  if (done === 0) return ''
  const elapsed = (Date.now() - startTime) / 1000
  const perItem = elapsed / done
  const remaining = Math.ceil((total - done) * perItem)
  if (remaining < 60) return `~${remaining}s remaining`
  return `~${Math.ceil(remaining / 60)} min remaining`
}
```

**Step 3: Add renderEventPage function**

This renders when the user is on a Luma event page with no running campaign, or when in a scan flow:

```typescript
async function renderEventPage(ctx: Extract<TabContext, { kind: 'luma-event' }>): Promise<void> {
  if (scanState.type === 'idle') {
    // Check if this event was already scanned
    const existing: { eventId: string; existingUrls: string[]; linkedInCount: number } = await new Promise(resolve => {
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        chrome.runtime.sendMessage({ type: 'GET_EVENT_BY_URL', lumaUrl: tab?.url ?? '' }, resolve)
      })
    })
    if (existing?.eventId && existing.existingUrls.length > 0) {
      scanState = { type: 'already_scanned', count: existing.existingUrls.length, linkedInCount: existing.linkedInCount, eventId: existing.eventId, eventName: ctx.eventName }
    }
  }

  if (scanState.type === 'idle') {
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section event-hero">
        <div class="event-name">${escHtml(ctx.eventName || 'This event')}</div>
        <div class="event-meta">Luma event</div>
      </div>
      <div class="section">
        <button class="btn btn-primary" id="btnScan">Scan attendees for LinkedIn profiles</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    document.getElementById('btnScan')!.addEventListener('click', () => startScan(ctx))
    return
  }

  if (scanState.type === 'already_scanned') {
    const s = scanState
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="event-name">${escHtml(ctx.eventName || 'This event')}</div>
        <div class="already-count" style="margin-top:8px;">${s.count} attendees scanned · ${s.linkedInCount} on LinkedIn</div>
      </div>
      <div class="section">
        <button class="btn btn-primary" id="btnRescan">Scan again for new attendees</button>
        <button class="btn btn-secondary" id="btnViewProgress" style="margin-top:8px;">View campaign progress</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    document.getElementById('btnRescan')!.addEventListener('click', () => startScan(ctx))
    document.getElementById('btnViewProgress')!.addEventListener('click', () => {
      scanState = { type: 'progress' }
      render()
    })
    return
  }

  if (scanState.type === 'scanning') {
    const s = scanState
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
    const eta = s.total > 0 ? etaString(s.done, s.total, s.startTime) : ''
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
        <span class="status-pill pill-running"><span class="dot"></span>Scanning</span>
      </div>
      <div class="section">
        <div class="scanning-label">Scanning <strong>${escHtml(s.currentName || '...')}</strong></div>
        <div class="progress-bg"><div class="progress-fill" style="width:${pct}%"></div></div>
        <div class="progress-meta"><span>${s.done}/${s.total}</span><span>${eta}</span></div>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    return
  }

  if (scanState.type === 'results') {
    const s = scanState
    if (!noteValue) noteValue = defaultNote(s.eventName)
    const linkedInReady: boolean = await new Promise(resolve => chrome.runtime.sendMessage({ type: 'CHECK_LINKEDIN_LOGIN' }, r => resolve(r?.loggedIn ?? false)))
    const leadsHtml = s.contacts.filter(c => c.linkedInUrl).map(c => {
      const ini = initials(c.name)
      return `<div class="lead-row">
        <div class="lead-initials">${escHtml(ini)}</div>
        <div class="lead-name">${escHtml(c.name)}</div>
        <div class="lead-badges">
          ${c.linkedInUrl ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="badge badge-li">in</a>` : ''}
          ${c.instagramUrl ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="badge badge-ig">ig</a>` : ''}
          ${c.twitterUrl ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="badge badge-x">x</a>` : ''}
        </div>
      </div>`
    }).join('')

    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="results-count">Found ${s.found} on LinkedIn</div>
        <div class="results-sub">out of ${s.total} attendees scanned</div>
        ${s.contacts.length > 0 ? `<div class="leads-list">${leadsHtml}</div>` : ''}
        <div class="field-label">
          Message <span class="char-count" id="charCount">(optional) ${noteValue.length}/${MAX_NOTE}</span>
        </div>
        <textarea id="noteInput" maxlength="${MAX_NOTE}">${escHtml(noteValue)}</textarea>
        ${s.eventId ? `
          <div class="li-status ${linkedInReady ? 'ok' : 'warn'}">
            ${linkedInReady ? '✓ LinkedIn ready' : '⚠ Not logged into LinkedIn &nbsp;<a class="li-open" href="https://www.linkedin.com/login" target="_blank">Open LinkedIn ↗</a>'}
          </div>
          <button class="btn btn-primary" id="btnConnect" ${linkedInReady ? '' : 'disabled'} style="margin-top:8px;">
            Send connection requests to ${s.found} people
          </button>
        ` : renderAuthGate()}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    document.getElementById('noteInput')?.addEventListener('input', (e) => {
      noteValue = (e.target as HTMLTextAreaElement).value
      const el = document.getElementById('charCount')
      if (el) el.textContent = `(optional) ${noteValue.length}/${MAX_NOTE}`
    })
    document.getElementById('btnConnect')?.addEventListener('click', () => launchCampaign(s))
    wireAuthGate()
    return
  }

  if (scanState.type === 'launched') {
    const s = scanState
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section" style="text-align:center;padding:32px 20px;">
        <div class="launched-icon">🎉</div>
        <div class="launched-title">Campaign launched!</div>
        <div class="launched-sub">${s.queued} connection request${s.queued === 1 ? '' : 's'} queued</div>
        <div class="launched-note">We'll send them slowly during business hours — 35/day max — to keep your account safe.</div>
        <button class="btn btn-secondary" id="btnDone">Done</button>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    document.getElementById('btnDone')!.addEventListener('click', () => {
      scanState = { type: 'idle' }
      render()
    })
    return
  }
}
```

**Step 4: Add auth gate helpers**

```typescript
function renderAuthGate(): string {
  return `
    <div class="auth-gate" id="authGate">
      <div class="auth-label">${authMode === 'signup' ? 'Create an account' : 'Sign in'} to launch</div>
      <input id="authEmail" type="email" placeholder="Email" autocomplete="email">
      <input id="authPassword" type="password" placeholder="Password" autocomplete="current-password">
      <div class="auth-error" id="authError"></div>
      <button class="btn btn-primary" id="btnAuthSubmit" style="margin-top:4px;">
        ${authMode === 'signup' ? 'Create account' : 'Sign in'}
      </button>
      <div class="auth-toggle">
        ${authMode === 'signup'
          ? 'Already have an account? <button class="auth-toggle-btn" id="btnToggleAuth">Sign in</button>'
          : 'New here? <button class="auth-toggle-btn" id="btnToggleAuth">Create account</button>'}
      </div>
    </div>
  `
}

function wireAuthGate(): void {
  document.getElementById('btnToggleAuth')?.addEventListener('click', () => {
    authMode = authMode === 'signup' ? 'signin' : 'signup'
    render()
  })
  document.getElementById('btnAuthSubmit')?.addEventListener('click', async () => {
    const email = (document.getElementById('authEmail') as HTMLInputElement)?.value ?? ''
    const password = (document.getElementById('authPassword') as HTMLInputElement)?.value ?? ''
    const errEl = document.getElementById('authError')
    if (errEl) errEl.textContent = ''
    const type = authMode === 'signup' ? 'SIGN_UP' : 'SIGN_IN'
    const result: { success: boolean; error?: string } = await new Promise(r => chrome.runtime.sendMessage({ type, data: { email, password } }, r))
    if (!result.success) {
      if (errEl) errEl.textContent = result.error ?? 'Error'
    } else {
      render()
    }
  })
}
```

**Step 5: Add startScan and launchCampaign functions**

```typescript
function startScan(ctx: Extract<TabContext, { kind: 'luma-event' }>): void {
  scanState = { type: 'scanning', phase: 'starting', done: 0, total: 0, currentName: '', startTime: Date.now() }
  renderEventPage(ctx)
  chrome.tabs.sendMessage(ctx.tabId, { type: 'START_SCAN' })
}

async function launchCampaign(s: Extract<ScanState, { type: 'results' }>): Promise<void> {
  const result: { queued: number; eventId: string } = await new Promise(resolve => {
    chrome.runtime.sendMessage({ type: 'LAUNCH_CAMPAIGN', data: { eventId: s.eventId, note: noteValue } }, resolve)
  })
  scanState = { type: 'launched', queued: result.queued, eventId: result.eventId }
  render()
}
```

**Step 6: Listen for scan progress messages from luma.ts**

Add at the bottom of `sidepanel.ts`, before `render()`:

```typescript
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'SCAN_PROGRESS') {
    if (scanState.type !== 'scanning') return
    scanState = {
      ...scanState,
      phase: msg.phase,
      done: msg.done ?? scanState.done,
      total: msg.total ?? scanState.total,
      currentName: msg.currentName ?? scanState.currentName,
    }
    // Get current tab context to re-render
    resolveTabContext().then(ctx => {
      if (ctx.kind === 'luma-event') renderEventPage(ctx)
    })
  }
  if (msg.type === 'SCAN_COMPLETE') {
    scanState = {
      type: 'results',
      found: msg.found,
      total: msg.total,
      eventId: msg.eventId,
      eventName: (scanState as any).eventName ?? '',
      contacts: msg.contacts ?? [],
    }
    resolveTabContext().then(ctx => {
      if (ctx.kind === 'luma-event') renderEventPage(ctx)
    })
  }
})
```

**Step 7: Update render() to call renderEventPage**

Update the `render()` function:

```typescript
async function render(): Promise<void> {
  renderLoading()
  const [state, ctx] = await Promise.all([resolveAppState(), resolveTabContext()])

  // If we're mid-scan, always show event page view regardless of campaign state
  if (scanState.type !== 'idle' && ctx.kind === 'luma-event') {
    await renderEventPage(ctx)
    return
  }

  if (state.type === 'campaign') {
    await renderCampaign(state)
  } else if (ctx.kind === 'luma-event') {
    await renderEventPage(ctx)
  } else {
    renderLanding(state.ctx)
  }
}
```

**Step 8: Build + test end-to-end**

```bash
cd extension && npm run build
```

Go to a Luma event page → side panel should show "Scan attendees" button → click it → scanning progress animates → results appear with lead list → note field → launch button.

**Step 9: Commit**

```bash
git add extension/sidepanel/sidepanel.ts
git commit -m "feat: side panel scan flow — event page, scanning, results, auth, launch"
```

---

### Task 7: Remove onClicked listener from service worker

With the side panel registered, the icon click is handled by Chrome automatically. The `onClicked` listener is no longer needed.

**Files:**
- Modify: `extension/background/service-worker.ts`

**Step 1: Delete the onClicked block**

Find and remove lines 43–65:

```typescript
chrome.action.onClicked.addListener(async () => {
  // ... entire block ...
})
```

**Step 2: Build + verify**

```bash
cd extension && npm run build
```

Reload extension. Click icon → side panel opens (no new tabs ever opened). Correct.

**Step 3: Commit**

```bash
git add extension/background/service-worker.ts
git commit -m "feat: remove onClicked listener — side panel handles icon click"
```

---

### Task 8: Clean up old files

Now that the side panel handles everything, delete the old content-script panel and orphaned popup.

**Files:**
- Delete: `extension/content/panel.ts`
- Delete: `extension/content/panel.css`
- Delete: `extension/popup/popup.ts`
- Delete: `extension/popup/popup.html`
- Delete: `extension/dist/panel.js` (stale build artifact)
- Delete: `extension/dist/panel.css` (stale build artifact)
- Delete: `extension/dist/popup.js` (stale build artifact)

**Step 1: Delete files**

```bash
cd extension
rm content/panel.ts content/panel.css
rm popup/popup.ts popup/popup.html
rm -f dist/panel.js dist/panel.css dist/popup.js
```

**Step 2: Build — confirm no errors**

```bash
npm run build
```

The build script no longer references panel.ts or popup.ts, so this should succeed cleanly.

**Step 3: Verify full flow still works**

- Non-Luma tab → landing page ✓
- Luma event page → scan flow ✓
- Running campaign → stats + activity feed ✓
- Pause/resume → works ✓
- No orphaned UI injected into Luma pages ✓

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: delete old content panel and popup — side panel is now primary UI"
```

---

## Summary

| Task | What it delivers |
|------|-----------------|
| 1 | Scaffold — manifest, build, HTML shell |
| 2 | Full CSS design system |
| 3 | Landing page (fixes the scary UX immediately) |
| 4 | Campaign status view (stats, progress bar, activity feed) |
| 5 | luma.ts scan message handler |
| 6 | Full scan → results → launch flow in side panel |
| 7 | Remove legacy onClicked behavior |
| 8 | Delete old panel and popup files |

Tasks 1–4 already fix the core UX problem. Tasks 5–6 complete the full feature parity. Tasks 7–8 clean up.
