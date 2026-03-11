# Design: Chrome Side Panel

Date: 2026-02-26

## Problem

After removing the popup, clicking the extension icon on a non-Luma page silently opens a new Luma tab. Users on unrelated pages (Gmail, Twitter, etc.) feel like the extension hijacked their browser. There is no safe, contained UI for checking campaign status or understanding the tool when not on Luma.

## Decision

Replace the current `chrome.action.onClicked` navigation behavior with a Chrome Side Panel (chrome.sidePanel API). The side panel is a proper browser-native sidebar — it works on all pages, never auto-navigates, and gives users a safe place to check status and control the campaign from anywhere.

The existing content-script panel on Luma pages is removed. The side panel becomes the single unified UI.

## Context States

The side panel renders different content based on where the user is and whether a campaign is running.

### State 1: Landing page (not on Luma, or on Luma but not an event page)

**Layout:**

- Full-bleed gradient hero header: `#4f46e5` → `#7c3aed`
  - User's `icon48.png` logo at 64px, centered
  - "I Hate Networking" in Montserrat 700, white
  - "networking, automated" in 12px white/60%
- Tagline below hero: **"Event follow-up shouldn't be your second job."** — 15px #111827
- Divider
- 3 numbered steps (indigo circle numbers):
  1. Go to a Luma event page
  2. Scan the guest list — we find everyone's LinkedIn
  3. Connections send automatically — 35/day max · business hours only · keeps your account safe
- Divider
- Full-width indigo CTA button: "Open Luma.com →"
- Byline: "by Jenny Chen" — 11px #d1d5db, bottom

**Variation — on Luma but not an event page:**
Same layout. Step 1 changes to "Open a specific event page". CTA changes to "Browse Luma events →" linking to `lu.ma/events`.

### State 2: On a Luma event page, no campaign

Same landing page layout, but:
- Steps replaced with: event name + guest count detected
- CTA: "Scan attendees" — triggers scan flow

The scan → review → launch flow moves into the side panel (replacing the old content-script panel).

### State 3: Campaign running (any page)

**Header:** compact — logo + brand name + animated green "● Running" pill

**Stats cards row** (3 equal cards, subtle border):
- Connected (green number)
- Queued (black number)
- Skipped (red number, only shown if > 0)

**Progress bar:**
- Indigo fill, gray track, percentage label right-aligned
- Below: "Next connection in ~X min" — 11px #9ca3af (read from `nextScheduledAt` in storage)

**Pause/resume control:**
- Full-width secondary button: "⏸ Pause campaign" / "▶ Resume campaign"

**Activity feed — "Recently Connected":**
- Section label: "RECENTLY CONNECTED" (10px uppercase) + "view all" link
- Scrollable list, no row cap
- Each row:
  - 32px initials avatar (indigo bg, white text)
  - Name (13px #111827)
  - Job title · Company (11px #9ca3af) — shown when LinkedIn data available, gracefully absent otherwise
  - Event name pill (indigo-light tag, 10px)
- Rows grouped/sorted by most recent first

**Bottom CTA:**
- Secondary button: "+ Scan another event" — navigates to Luma on click

## Architecture

- **Chrome Side Panel API** (`chrome.sidePanel`): registered in manifest as `side_panel.default_path`
- The side panel is its own HTML page (`sidepanel/sidepanel.html`) — not injected into pages
- Reads campaign state directly from `chrome.storage.local` (same keys as before: `queuePending`, `campaignPaused`, `nextScheduledAt`, `lastSentAt`, `lastSentName`)
- Reads full activity data via `GET_PROGRESS_DATA` message to service worker
- Detects current tab URL via `chrome.tabs.query` to determine which state to render
- Listens for `chrome.tabs.onActivated` + `chrome.tabs.onUpdated` to re-render when user navigates

**Manifest changes:**
- Add `"sidePanel"` to `permissions`
- Add `"side_panel": { "default_path": "sidepanel/sidepanel.html" }` key
- Remove `chrome.action.onClicked` listener from service worker (side panel opens automatically on icon click when registered)
- Remove content scripts for `panel.js` and `panel.css` (panel moves into side panel)
- Remove the floating `#ihn-btn` trigger button from Luma pages

**Files:**
- `extension/sidepanel/sidepanel.html` (new)
- `extension/sidepanel/sidepanel.ts` (new)
- `extension/sidepanel/sidepanel.css` (new)
- `extension/content/panel.ts` — delete
- `extension/content/panel.css` — delete
- `extension/background/service-worker.ts` — remove `onClicked` listener
- `extension/manifest.json` — update permissions + action + side_panel key

## Design Tokens (consistent with existing theme)

```
Primary:        #4f46e5
Primary hover:  #4338ca
Primary light:  #e0e7ff
Gradient end:   #7c3aed
Text:           #111827
Text secondary: #6b7280
Text muted:     #9ca3af
Border:         #e5e7eb
Background:     #ffffff
Surface:        #f9fafb
Green:          #22c55e
Red:            #ef4444
Font brand:     Montserrat 700/300
Font body:      -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif
```

## Out of Scope

- LinkedIn enrichment display (job title/company) — layout supports it, data layer deferred
- "View all" full activity page — link present, detail view deferred
- Multi-event pause per-event controls — carry over from existing panel if straightforward
- Export functionality — carry over from existing panel
