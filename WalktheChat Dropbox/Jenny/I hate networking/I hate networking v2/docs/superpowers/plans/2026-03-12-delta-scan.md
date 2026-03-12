# Delta Scan Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When re-scanning a previously scanned event, skip enrichment for known contacts and show cached contacts immediately while the scan runs.

**Architecture:** Three changes: (1) sidepanel stores contacts + existingUrls in `already_scanned` state and shows them immediately; (2) a `cachedContacts` module variable holds them during the scan so they stay visible; (3) luma.ts receives `existingUrls`, computes a delta, and only enriches new contacts.

**Tech Stack:** TypeScript, esbuild, Chrome Extensions API, Supabase

**Spec:** `docs/superpowers/specs/2026-03-12-delta-scan-design.md`

---

## Chunk 1: sidepanel.ts — state, render, and SCAN_COMPLETE

### Task 1: Extend `already_scanned` state type and populate contacts from DB

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:17, 19, 899, 904-906`

Context: `GET_EVENT_BY_URL` already returns `contacts` with snake_case fields (`linkedin_url`, `luma_profile_url`, etc.) but the sidepanel discards them. The rest of the codebase uses camelCase (`linkedInUrl`, `url`). We map to camelCase at the storage point so downstream render code works unchanged.

- [ ] **Step 1: Extend `already_scanned` type variant (line 17)**

Replace:
```typescript
| { type: 'already_scanned'; count: number; linkedInCount: number; eventId: string; eventName: string }
```
With:
```typescript
| { type: 'already_scanned'; count: number; linkedInCount: number; eventId: string; eventName: string; contacts: any[]; existingUrls: string[] }
```

- [ ] **Step 2: Add optional `newCount` to `results` type variant (line 19)**

Replace:
```typescript
| { type: 'results'; found: number; total: number; eventId: string; eventName: string; eventUrl?: string; contacts: any[]; scanDebug?: any }
```
With:
```typescript
| { type: 'results'; found: number; total: number; eventId: string; eventName: string; eventUrl?: string; contacts: any[]; scanDebug?: any; newCount?: number }
```

- [ ] **Step 3: Widen `GET_EVENT_BY_URL` response type (line 899)**

Replace:
```typescript
const existing: { eventId: string; existingUrls: string[]; linkedInCount: number } = await new Promise(resolve => {
```
With:
```typescript
const existing: { eventId: string; existingUrls: string[]; linkedInCount: number; contacts: any[] } = await new Promise(resolve => {
```

- [ ] **Step 4: Store contacts (mapped to camelCase) and existingUrls in state (lines 904-906)**

Replace:
```typescript
    if (existing?.eventId && existing.existingUrls.length > 0) {
      scanState = { type: 'already_scanned', count: existing.existingUrls.length, linkedInCount: existing.linkedInCount, eventId: existing.eventId, eventName: ctx.eventName }
    }
```
With:
```typescript
    if (existing?.eventId && existing.existingUrls.length > 0) {
      const mappedContacts = (existing.contacts ?? []).map((c: any) => ({
        url: c.luma_profile_url,
        name: c.name,
        linkedInUrl: c.linkedin_url,
        instagramUrl: c.instagram_url,
        twitterUrl: c.twitter_url,
        websiteUrl: c.website_url,
        isHost: c.is_host,
      }))
      scanState = { type: 'already_scanned', count: existing.existingUrls.length, linkedInCount: existing.linkedInCount, eventId: existing.eventId, eventName: ctx.eventName, contacts: mappedContacts, existingUrls: existing.existingUrls }
    }
```

- [ ] **Step 5: Build to verify no TypeScript errors**

```bash
cd "extension" && npm run build 2>&1 | tail -5
```
Expected: build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add extension/sidepanel/sidepanel.ts extension/dist/sidepanel.js
git commit -m "feat(delta-scan): extend already_scanned state with contacts and existingUrls"
```

---

### Task 2: Add `cachedContacts` module variable

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts` (after line 29, near other module-level `let` vars)

`cachedContacts` stores the contact list from the `already_scanned` state so it remains visible during the scanning progress view. It is populated just before `startScan` is called on rescan, and cleared after `SCAN_COMPLETE` is handled.

- [ ] **Step 1: Add module variable after `let exportSelected = ...` (line 29)**

After the line:
```typescript
let exportSelected = new Set<string>()
```
Add:
```typescript
let cachedContacts: any[] = []
```

- [ ] **Step 2: Build to verify**

```bash
cd "extension" && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts extension/dist/sidepanel.js
git commit -m "feat(delta-scan): add cachedContacts module variable"
```

---

### Task 3: Update `startScan` to accept and forward `existingUrls`

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:872-877`

`startScan` needs to pass `existingUrls` in the `START_SCAN` message so the luma.ts content script knows which contacts to skip.

- [ ] **Step 1: Update `startScan` signature and message (lines 872-877)**

Replace:
```typescript
function startScan(ctx: Extract<TabContext, { kind: 'luma-event' }>, hasCampaign = false): void {
  noteValue = ''
  scanState = { type: 'scanning', phase: 'starting', done: 0, total: 0, currentName: '', startTime: Date.now(), eventName: ctx.eventName }
  renderEventPage(ctx, hasCampaign)
  chrome.tabs.sendMessage(ctx.tabId, { type: 'START_SCAN' })
}
```
With:
```typescript
function startScan(ctx: Extract<TabContext, { kind: 'luma-event' }>, hasCampaign = false, existingUrls: string[] = []): void {
  noteValue = ''
  scanState = { type: 'scanning', phase: 'starting', done: 0, total: 0, currentName: '', startTime: Date.now(), eventName: ctx.eventName }
  renderEventPage(ctx, hasCampaign)
  chrome.tabs.sendMessage(ctx.tabId, { type: 'START_SCAN', existingUrls })
}
```

- [ ] **Step 2: Build to verify**

```bash
cd "extension" && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts extension/dist/sidepanel.js
git commit -m "feat(delta-scan): pass existingUrls in START_SCAN message"
```

---

### Task 4: Update `already_scanned` render — show contacts and wire rescan

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:930-954`

Replace the `already_scanned` render block — it currently shows only a count and buttons. New version shows the full contact list (same layout as the `results` view) with "Scan for new attendees" at top.

- [ ] **Step 1: Replace `already_scanned` render block (lines 930-954)**

Replace:
```typescript
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
        <div class="already-count" style="margin-top:8px;font-size:13px;color:#6b7280;">${s.count} attendees scanned · ${s.linkedInCount} on LinkedIn</div>
      </div>
      <div class="section">
        <button class="btn btn-primary" id="btnRescan">Scan again for new attendees</button>
        ${hasCampaign ? `<button class="btn btn-secondary" id="btnViewProgress" style="margin-top:8px;">View campaign progress</button>` : ''}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    document.getElementById('btnRescan')!.addEventListener('click', () => startScan(ctx, hasCampaign))
    document.getElementById('btnViewProgress')?.addEventListener('click', () => {
      scanState = { type: 'idle' }
      render()
    })
    return
  }
```
With:
```typescript
  if (scanState.type === 'already_scanned') {
    const s = scanState
    const cachedLeadsHtml = s.contacts.filter(c => c.linkedInUrl).map(c => `
      <div class="lead-row">
        <div class="lead-initials">${escHtml(initials(c.name))}</div>
        <div class="lead-name">${escHtml(c.name)}</div>
        <div class="lead-badges">
          ${c.linkedInUrl ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="badge badge-li">in</a>` : ''}
          ${c.instagramUrl ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="badge badge-ig">ig</a>` : ''}
          ${c.twitterUrl ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="badge badge-x">x</a>` : ''}
        </div>
      </div>`).join('')
    root.innerHTML = `
      <div class="compact-header">
        <div class="compact-brand">
          <img src="../icons/icon48.png" class="compact-logo" alt="">
          <span class="compact-name">I Hate Networking</span>
        </div>
      </div>
      <div class="section">
        <div class="event-name">${escHtml(ctx.eventName || 'This event')}</div>
        <div class="already-count" style="margin-top:8px;font-size:13px;color:#6b7280;">${s.count} attendees scanned · ${s.linkedInCount} on LinkedIn</div>
        <button class="btn btn-secondary" id="btnRescan" style="margin-top:12px;">Scan for new attendees</button>
        ${hasCampaign ? `<button class="btn btn-secondary" id="btnViewProgress" style="margin-top:8px;">View campaign progress</button>` : ''}
        ${cachedLeadsHtml.length > 0 ? `<div class="leads-list" style="margin-top:12px;">${cachedLeadsHtml}</div>` : ''}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    document.getElementById('btnRescan')!.addEventListener('click', () => {
      cachedContacts = s.contacts
      startScan(ctx, hasCampaign, s.existingUrls)
    })
    document.getElementById('btnViewProgress')?.addEventListener('click', () => {
      scanState = { type: 'idle' }
      render()
    })
    return
  }
```

- [ ] **Step 2: Build to verify**

```bash
cd "extension" && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts extension/dist/sidepanel.js
git commit -m "feat(delta-scan): show cached contacts in already_scanned state"
```

---

### Task 5: Show `cachedContacts` in the scanning progress view

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:957-977`

When `cachedContacts.length > 0` (i.e., this is a delta re-scan), the scanning view should show the cached contact list below the progress bar so the user isn't staring at a blank screen.

- [ ] **Step 1: Update `scanning` render block (lines 957-977)**

Replace:
```typescript
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
        <div class="progress-meta"><span>${s.done}/${s.total || '?'}</span><span>${eta}</span></div>
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    return
  }
```
With:
```typescript
  if (scanState.type === 'scanning') {
    const s = scanState
    const pct = s.total > 0 ? Math.round((s.done / s.total) * 100) : 0
    const eta = s.total > 0 ? etaString(s.done, s.total, s.startTime) : ''
    const scanningCachedHtml = cachedContacts.filter(c => c.linkedInUrl).map(c => `
      <div class="lead-row">
        <div class="lead-initials">${escHtml(initials(c.name))}</div>
        <div class="lead-name">${escHtml(c.name)}</div>
        <div class="lead-badges">
          ${c.linkedInUrl ? `<a href="${escHtml(c.linkedInUrl)}" target="_blank" class="badge badge-li">in</a>` : ''}
          ${c.instagramUrl ? `<a href="${escHtml(c.instagramUrl)}" target="_blank" class="badge badge-ig">ig</a>` : ''}
          ${c.twitterUrl ? `<a href="${escHtml(c.twitterUrl)}" target="_blank" class="badge badge-x">x</a>` : ''}
        </div>
      </div>`).join('')
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
        <div class="progress-meta"><span>${s.done}/${s.total || '?'}</span><span>${eta}</span></div>
        ${scanningCachedHtml.length > 0 ? `<div class="leads-list" style="margin-top:12px;">${scanningCachedHtml}</div>` : ''}
      </div>
      <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
    `
    return
  }
```

- [ ] **Step 2: Build to verify**

```bash
cd "extension" && npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add extension/sidepanel/sidepanel.ts extension/dist/sidepanel.js
git commit -m "feat(delta-scan): show cached contacts during scanning progress view"
```

---

### Task 6: Update SCAN_COMPLETE handler — merge contacts and show "+ N new"

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts:1237-1268`

On `SCAN_COMPLETE` during a delta scan:
- `cachedContacts` holds existing contacts (camelCase)
- `msg.contacts` holds only NEW contacts (also camelCase, from luma.ts)
- Merge them, set `results` state with combined list and `newCount`
- Clear `cachedContacts`

**Why in-memory merge instead of DB re-fetch:** The spec mentions re-fetching from `GET_EVENT_BY_URL` after SCAN_COMPLETE, but the in-memory merge is equivalent here. We only upsert `newContacts` to the DB (not existing contacts), so a DB re-fetch returns the same data as `cachedContacts` for existing entries. No round-trip needed.

**Why not clearing `cachedContacts` on scan error:** If the scan never fires `SCAN_COMPLETE` (tab closed, luma.ts crash), `cachedContacts` stays set. On the next `btnRescan` click, `cachedContacts` is overwritten with fresh data before `startScan` is called, so stale state cannot persist into a future scan.

- [ ] **Step 1: Update SCAN_COMPLETE handler (lines 1237-1268)**

Replace:
```typescript
  if (msg.type === 'SCAN_COMPLETE') {
    // Capture the tab URL for this scan
    const tabUrl = await new Promise<string>(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => resolve(t?.url ?? ''))
    )
    scanState = {
      type: 'results',
      found: msg.found,
      total: msg.total,
      eventId: msg.eventId,
      eventName: (scanState as any).eventName ?? '',
      eventUrl: tabUrl,
      contacts: msg.contacts ?? [],
      scanDebug: msg.scanDebug,
    }
```
With:
```typescript
  if (msg.type === 'SCAN_COMPLETE') {
    // Capture the tab URL for this scan
    const tabUrl = await new Promise<string>(resolve =>
      chrome.tabs.query({ active: true, currentWindow: true }, ([t]) => resolve(t?.url ?? ''))
    )
    const isDelta = cachedContacts.length > 0
    const mergedContacts = isDelta ? [...cachedContacts, ...(msg.contacts ?? [])] : (msg.contacts ?? [])
    cachedContacts = []
    scanState = {
      type: 'results',
      found: mergedContacts.filter((c: any) => c.linkedInUrl).length,
      total: mergedContacts.length,
      eventId: msg.eventId,
      eventName: (scanState as any).eventName ?? '',
      eventUrl: tabUrl,
      contacts: mergedContacts,
      scanDebug: msg.scanDebug,
      newCount: isDelta ? (msg.newCount ?? 0) : undefined,
    }
```

- [ ] **Step 2: Show "+ N new contacts found" in results render (line 1084)**

In the results render, after `<div class="results-sub">out of ${s.total} attendees scanned</div>` (line 1085), add a new contacts indicator. Replace:
```typescript
        <div class="results-count">Found ${s.found} contacts</div>
        <div class="results-sub">out of ${s.total} attendees scanned</div>
```
With:
```typescript
        <div class="results-count">Found ${s.found} contacts</div>
        <div class="results-sub">out of ${s.total} attendees scanned${s.newCount != null && s.newCount > 0 ? ` · <span style="color:#16a34a">+${s.newCount} new</span>` : s.newCount === 0 ? ' · no new attendees' : ''}</div>
```

- [ ] **Step 3: Build to verify**

```bash
cd "extension" && npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add extension/sidepanel/sidepanel.ts extension/dist/sidepanel.js
git commit -m "feat(delta-scan): merge cached+new contacts on SCAN_COMPLETE, show new count"
```

---

## Chunk 2: luma.ts — delta filtering

### Task 7: Accept `existingUrls` in `runScan`, skip enrichment for known contacts

**Files:**
- Modify: `extension/content/luma.ts:385, 488-551, 557-559`

`normalizeProfileUrl` is defined inside `runScan`. The `existingUrls` from the DB were stored using that same normalization (they went through this same function on first scan). Use the same function to build `existingUrlsSet` for comparison.

- [ ] **Step 1: Update `runScan` signature (line 385)**

Replace:
```typescript
async function runScan(): Promise<void> {
```
With:
```typescript
async function runScan(existingUrls: string[] = []): Promise<void> {
```

- [ ] **Step 2: Add `existingUrlsSet`, compute `newContacts`, and fix `scraping_done` total (lines 488-491)**

Replace:
```typescript
  const apiHadSocial = contacts.some(c => c.linkedInUrl)
  console.log('[IHN] Contacts from API:', contacts.length, 'with LinkedIn from API:', contacts.filter(c => c.linkedInUrl).length)

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'scraping_done', total: contacts.length, eventName, lumaUrl })
```
With:
```typescript
  const apiHadSocial = contacts.some(c => c.linkedInUrl)
  console.log('[IHN] Contacts from API:', contacts.length, 'with LinkedIn from API:', contacts.filter(c => c.linkedInUrl).length)

  const existingUrlsSet = new Set(existingUrls)
  const newContacts = existingUrlsSet.size > 0 ? contacts.filter(c => !existingUrlsSet.has(c.url)) : contacts
  console.log('[IHN] Delta scan: existingUrls:', existingUrlsSet.size, 'newContacts:', newContacts.length)

  chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'scraping_done', total: newContacts.length, eventName, lumaUrl })
```

- [ ] **Step 3: Scope enrichment to `newContacts` only (line 494)**

Replace:
```typescript
  if (!apiHadSocial && contacts.length > 0) {
    console.log('[IHN] API had no social data, fetching profile pages as fallback')
    let done = 0
    for (const contact of contacts) {
```
With:
```typescript
  if (!apiHadSocial && newContacts.length > 0) {
    console.log('[IHN] API had no social data, fetching profile pages as fallback')
    let done = 0
    for (const contact of newContacts) {
```

Also update the progress total — replace `total: contacts.length` in the enriching SCAN_PROGRESS (line 519) with `total: newContacts.length`. Replace:
```typescript
      chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'enriching', done, total: contacts.length, currentName: contact.name })
```
With:
```typescript
      chrome.runtime.sendMessage({ type: 'SCAN_PROGRESS', phase: 'enriching', done, total: newContacts.length, currentName: contact.name })
```

- [ ] **Step 4: Send only `newContacts` to `START_ENRICHMENT` and add `newCount` to `SCAN_COMPLETE` (lines 527-551)**

Replace:
```typescript
  const saveResult: { eventId: string; found: number; total: number } = await Promise.race([
    new Promise<any>(resolve => {
      chrome.runtime.sendMessage({ type: 'START_ENRICHMENT', data: { tabId: 0, lumaUrl, eventName, contacts } }, resolve)
    }),
    new Promise<any>(resolve => setTimeout(() => resolve({ eventId: '', found: 0, total: contacts.length }), 15000)),
  ])

  // Use actual content-script counts — saveResult may return 0s if session/save failed
  const actualTotal = contacts.length
  const actualFound = contacts.filter(c => c.linkedInUrl).length
  console.log('[IHN] SCAN_COMPLETE sending. total:', actualTotal, 'found:', actualFound, 'eventId:', saveResult.eventId || '(save failed)')

  // Always send diagnostics — not just on zero contacts
  const scanDebug = {
    eventUrl: lumaUrl,
    buttonClicked,
    buttonTexts: allBtnTexts.slice(0, 10),
    preClickLinks: preClickLinks.size,
    apiGuestsCount: apiGuests.length,
    domGuestsCount: extractGuestProfileUrlsFromPage().length,
    modalFound: !!modal,
    apiHadSocial,
  }

  chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', eventId: saveResult.eventId, total: actualTotal, found: actualFound, contacts, scanDebug })
}
```
With:
```typescript
  const saveResult: { eventId: string; found: number; total: number } = await Promise.race([
    new Promise<any>(resolve => {
      chrome.runtime.sendMessage({ type: 'START_ENRICHMENT', data: { tabId: 0, lumaUrl, eventName, contacts: newContacts } }, resolve)
    }),
    new Promise<any>(resolve => setTimeout(() => resolve({ eventId: '', found: 0, total: newContacts.length }), 15000)),
  ])

  // Use actual content-script counts — saveResult may return 0s if session/save failed
  const actualTotal = newContacts.length
  const actualFound = newContacts.filter(c => c.linkedInUrl).length
  console.log('[IHN] SCAN_COMPLETE sending. newContacts:', actualTotal, 'found:', actualFound, 'eventId:', saveResult.eventId || '(save failed)')

  // Always send diagnostics — not just on zero contacts
  const scanDebug = {
    eventUrl: lumaUrl,
    buttonClicked,
    buttonTexts: allBtnTexts.slice(0, 10),
    preClickLinks: preClickLinks.size,
    apiGuestsCount: apiGuests.length,
    domGuestsCount: extractGuestProfileUrlsFromPage().length,
    modalFound: !!modal,
    apiHadSocial,
  }

  // newCount = new LinkedIn-bearing contacts (consistent with "contacts found" label in UI)
  chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', eventId: saveResult.eventId, total: actualTotal, found: actualFound, contacts: newContacts, newCount: actualFound, scanDebug })
}
```

- [ ] **Step 5: Pass `msg.existingUrls` to `runScan` in message listener (lines 557-559)**

Replace:
```typescript
  if (msg.type === 'START_SCAN') {
    runScan() // fire and forget — progress sent back via runtime.sendMessage
    sendResponse({ started: true })
```
With:
```typescript
  if (msg.type === 'START_SCAN') {
    runScan(msg.existingUrls ?? []) // fire and forget — progress sent back via runtime.sendMessage
    sendResponse({ started: true })
```

- [ ] **Step 6: Build to verify**

```bash
cd "extension" && npm run build 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add extension/content/luma.ts extension/dist/luma.js
git commit -m "feat(delta-scan): skip enrichment for known contacts, send newCount in SCAN_COMPLETE"
```

---

## Chunk 3: Build and manual test

### Task 8: Final build and manual test

- [ ] **Step 1: Full clean build**

```bash
cd "extension" && npm run build 2>&1
```
Expected: all 5 files build cleanly, no errors.

- [ ] **Step 2: Load extension in Chrome**

1. Open `chrome://extensions`
2. Find "I Hate Networking" → click the reload button (↻)
3. Open the side panel

- [ ] **Step 3: Test first scan (no prior scan)**

1. Navigate to a Luma event URL
2. Open side panel → should show "Scan attendees for LinkedIn profiles" button
3. Click scan → scan runs normally, enriches all contacts
4. Results appear as before

- [ ] **Step 4: Test delta re-scan**

1. Stay on the same Luma event page, close and reopen the side panel
2. Should immediately show cached contacts (the LinkedIn profiles list)
3. Should show count "N attendees scanned · M on LinkedIn"
4. "Scan for new attendees" button should be visible
5. Click "Scan for new attendees"
6. Contacts remain visible during scan, progress bar appears above them
7. After scan: results show "Found X contacts · out of Y attendees scanned · no new attendees" (or "+ N new" if new people joined)

- [ ] **Step 5: Test zero new attendees path**

If no new attendees since last scan: progress clears, results show "· no new attendees" in sub-count.

- [ ] **Step 6: Test not-logged-in path**

1. Sign out of the IHN dashboard
2. Navigate to a Luma event → should show normal "Scan attendees" button (no cached contacts, full scan runs)

- [ ] **Step 7: Commit final build artifacts**

```bash
git add extension/dist/
git commit -m "feat(delta-scan): build artifacts"
```
