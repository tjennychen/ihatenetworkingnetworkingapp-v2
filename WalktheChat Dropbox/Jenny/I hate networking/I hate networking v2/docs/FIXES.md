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

## Template for new entries

```
## [YYYY-MM-DD] Short description

**Symptom:** What the user saw.

**Root cause:** Why it happened.

**Fix:** What was changed.

**Do not revert:** What future Claude must NOT undo.
```
