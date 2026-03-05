# Fixes Log

Track bugs that were fixed so they don't get reintroduced during rewrites.

---

## [2026-02-26] `state.pending` undefined crash in side panel render

**Symptom:** UI stuck on "Loading..." for all users with an active campaign.

**Root cause:** `sidepanel.ts` used bare `${pending}` in the stats card template string — `pending` was never declared in scope. This threw a silent `ReferenceError` that swallowed the whole `render()` call.

**Fix:** Changed to `${state.pending}`. Wrapped `render()` in a try/catch so errors surface instead of being swallowed silently.

**Do not revert:** Always use `state.pending` (not `pending`) when reading pending count in render context.

---

## [2026-02-26] LinkedIn tab opened as a new window (minimized), not a background tab

**Symptom:** A new Chrome window appeared (bounced in Dock) when sending connections, pulling focus away from the user's current page.

**Root cause:** Used `chrome.windows.create({ state: 'minimized' })` to open LinkedIn.

**Fix:** Switched to `chrome.tabs.create({ active: false })` — opens LinkedIn in a background tab in the current window, no new window, no Dock bounce.

**Do not revert:** Never use `chrome.windows.create` for opening LinkedIn tabs. Always use `chrome.tabs.create({ active: false })`.

---

## [2026-02-26] Side panel not opening on extension icon click

**Symptom:** Clicking the extension icon opened a new Luma tab instead of the side panel.

**Root cause:** Old `chrome.action.onClicked` listener was still registered, intercepting the click and navigating to Luma instead of letting the side panel open.

**Fix:** Removed the `onClicked` listener. Added `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })` in both `onInstalled` and `onStartup` so the side panel opens reliably.

**Do not revert:** Do not add back any `chrome.action.onClicked` listener. Side panel behavior is set via `setPanelBehavior`.

---

## [2026-02-26] Pause button used wrong variable for pending count

**Symptom:** Pause button showed incorrect state / wrong pending count.

**Root cause:** Referenced a local variable instead of `state.pending`.

**Fix:** Updated to `state.pending` consistently throughout the button render logic. Added `pill-done` CSS class for completed state styling.

---

## [2026-02-26] Hero logo blurry in side panel

**Symptom:** Logo appeared blurry/pixelated in the side panel header.

**Root cause:** A small icon was being upscaled to fill the hero slot.

**Fix:** Changed hero `<img>` src to `icon128.png` (largest available size) to avoid upscaling.

**Do not revert:** Always use `icon128.png` for any logo display larger than ~32px.

---

## [2026-02-26] 'View campaign progress' visible when no campaign running

**Symptom:** Link/button to view campaign progress showed up even when there was no active campaign.

**Fix:** Added a guard to hide the element when no campaign is in progress.

---

## [2026-02-26] Landing page shown when campaign is active

**Symptom:** Side panel shows the landing page ("Event follow-up shouldn't be your second job") even when a campaign with pending connections is running.

**Root cause:** `resolveAppState()` only checked `queuePending` in `chrome.storage.local` to detect an active campaign. Storage gets cleared when the extension is reloaded in dev mode (or if it becomes out of sync for any reason), so `queuePending` drops to 0 even though pending connections still exist in the DB.

**Fix:** Added a `GET_PENDING_COUNT` handler in the service worker that does a lightweight DB query (count of pending queue items). `resolveAppState()` now falls back to this DB check when storage shows 0. If the DB has pending items, storage is resynced and the campaign view is shown.

**Do not revert:** Do not remove the `GET_PENDING_COUNT` fallback. Storage is not a reliable source of truth for campaign state — the DB is.

---

## [2026-03-04] Transient failures permanently killed queue items

**Symptom:** Queue items with send_btn_not_found or no_response went straight to failed status, never retried.

**Root cause:** No retry logic — any failure immediately set status=failed.

**Fix:** Added TRANSIENT_ERRORS set in service-worker.ts. Errors in that set retry up to 3x with 3-5min delay (incrementing retry_count) before marking permanent failure. Permanent errors (already_connected, wrong_profile, weekly_limit_reached) fail immediately as before.

**Do not revert:** Never collapse transient and permanent errors into a single failure path again. retry_count must be incremented on transient retries, not reset.

---

## [2026-03-04] Fixed 800ms timeout caused send_btn_not_found on slow LinkedIn renders

**Symptom:** Send button not found even though modal was visible.

**Root cause:** setTimeout(800ms) after clicking Connect was a guess — LinkedIn's React rendering can take 1-2s on slow connections.

**Fix:** Replaced with waitForModal() — polls every 150ms up to 3s for [role="dialog"] or #interop-outlet shadow content. Resolves as soon as modal appears.

**Do not revert:** Never use setTimeout(800ms) as a modal wait. Use waitForModal().

---

## [2026-03-04] Fixed 2500ms tab buffer caused no_response errors

**Symptom:** Content script not ready when CONNECT message was sent — no_response errors.

**Root cause:** setTimeout(2500ms) after tab load was a guess. Some LinkedIn profiles load slowly.

**Fix:** Replaced with waitForContentScript() — pings GET_LINKEDIN_NAME every 500ms up to 12s. Uses wall-clock deadline (Date.now()) not tick counting. Short-circuits if tab is closed.

**Do not revert:** Never use setTimeout(2500ms) as a content script readiness check. Use waitForContentScript().

---

## [2026-03-05] `[aria-label*="Connect" i]` matched "Remove connection" — removed existing connections

**Symptom:** Extension opened already-connected profiles and removed the connection.

**Root cause:** `[aria-label*="Connect" i]` (contains, case-insensitive) matched aria-labels like "Remove connection with X" because "connection" contains "connect". Three sites were affected: aria-label search in open menu, `div[role="button"]` fallback, and last-resort `findButtonByText` call.

**Fix:** Changed all three to `[aria-label^="Connect" i]` (starts-with). Added `/^connect/i` text guard on `findButtonByText` results so only buttons whose text STARTS WITH "Connect" are returned.

**Do not revert:** NEVER use `[aria-label*="Connect"]` (contains) in any dropdown/menu context. Always use `^=` (starts-with) or add explicit "remove" exclusion guard.

---

## [2026-03-05] Campaign re-launch reset all queue entries including failed/sent

**Symptom:** Failed contacts were reopened repeatedly; extension visited already-connected profiles; sent contacts could be double-queued.

**Root cause:** Both `saveEnrichedContacts()` and `launchCampaign()` used `upsert(..., { onConflict: 'contact_id' })` without `ignoreDuplicates`. Every campaign re-launch overwrote ALL existing queue rows (pending/failed/sent) back to pending.

**Fix:** Added `ignoreDuplicates: true` to both upsert calls. New contacts get inserted; existing entries (any status) are left untouched.

**Do not revert:** Never upsert into `connection_queue` without `ignoreDuplicates: true`. Explicit resets must be done via SQL, never by re-launching the campaign.

---

## [2026-03-05] `namesMatch()` too strict — blocked first-name-same, last-name-different (Luma nicknames)

**Symptom:** `wrong_profile: expected "Akira Nirvana", got "Akira Hu"` — person uses stage name on Luma, real name on LinkedIn. Correct person, wrong name match.

**Root cause:** `namesMatch()` required ALL words in expected name to appear on page. Luma users commonly use nicknames/handles that don't match their LinkedIn real name.

**Fix:** Only require first name (first word) to match. LinkedIn URL from Luma is the authoritative identifier; name check is just a sanity guard against navigating to wrong page.

**Do not revert:** Do not go back to requiring all words to match. First name only is correct.

---

## [2026-03-05] Post-paywall Connect modal in broken state — Send click does nothing

**Symptom:** `paywall=yes|modalClosed=no` — paywall dismissed, Connect modal visible, Send button found and clicked, but modal never closed. Connection not sent.

**Root cause:** After dismissing a premium paywall, LinkedIn's Connect modal is left in a broken state. `nativeClick` on the Send button is silently ignored.

**Fix:** After any paywall dismissal, always close any remaining dialog and re-click Connect fresh for a clean modal. If paywall fires again immediately, return `paywall_loop` error.

**Do not revert:** Never try to send from the modal behind a just-dismissed paywall. Always close and re-click Connect.

---

## [2026-03-05] `findButtonByText('Send')` on `document.body` matched wrong button

**Symptom:** `status=sent` in DB but connection not actually sent. Extension clicked a non-Connect "Send" button elsewhere on page (messaging compose, InMail).

**Fix:** Scoped Send button search to `[role="dialog"]` only. Shadow DOM search (`#interop-outlet`) added as first search before regular DOM.

**Do not revert:** Always scope Send button search to the open dialog. Never search `document.body` for the Send button.

---

## [2026-03-05] No post-send verification — `success=true` without confirming modal closed

**Symptom:** DB showed `status=sent` but person not connected. Code returned success after clicking Send without verifying anything happened.

**Fix:** Poll for up to 3s after clicking Send waiting for modal to close. LinkedIn closes the modal on successful send. If modal stays open → return `send_unverified` (transient, will retry). New trace key: `modalClosed=yes/no`.

**Do not revert:** Never return `success=true` immediately after clicking Send. Always verify modal closes.

---

## [2026-03-05] pg_cron queue monitor — auto-resets retriable failures every 30 min

**What was added:** `public.ihn_queue_monitor()` function scheduled via pg_cron every 30 min. Resets `send_unverified`, `paywall_*`, `send_btn_not_found`, `wrong_connect_modal`, `no_response`, `linkedin_error` failures from last 24h back to pending. Logs results to `queue_monitor_log` table.

**To check monitor logs:** `SELECT * FROM queue_monitor_log ORDER BY ran_at DESC LIMIT 5;`

---

## Template for new entries

```
## [YYYY-MM-DD] Short description

**Symptom:** What the user saw.

**Root cause:** Why it happened.

**Fix:** What was changed.

**Do not revert:** What future Claude must NOT undo.
```
