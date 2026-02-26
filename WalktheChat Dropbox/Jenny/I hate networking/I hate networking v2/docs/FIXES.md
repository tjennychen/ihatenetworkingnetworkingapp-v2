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

## Template for new entries

```
## [YYYY-MM-DD] Short description

**Symptom:** What the user saw.

**Root cause:** Why it happened.

**Fix:** What was changed.

**Do not revert:** What future Claude must NOT undo.
```
