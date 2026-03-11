# Design: Remove Popup + Panel UX Improvements

Date: 2026-02-25

## Problem

The extension popup overlaps the panel on Luma pages, showing redundant info in two places simultaneously. Users are confused by slow pacing ("is it broken?") and unclear language ("sent" vs "connection request"). The chart shows "First connection coming soon" even after connections have been sent (bug).

## Decision

Remove the popup entirely. The panel is the primary UI. The extension icon click navigates to Luma.

## Changes

### 1. Remove popup

- Remove `action.default_popup` from `manifest.json`
- Add `chrome.action.onClicked` listener in service worker: focus existing Luma tab or open `lu.ma`
- Badge behavior unchanged (green dot = running, pause icon = paused)

### 2. Panel as primary UI

No nav bar. Panel uses contextual, sequential states (existing architecture kept).

Three structural improvements:
- **Progress is home**: if a campaign is running, panel opens to progress view by default on any Luma page (not idle)
- **"Scan another event" CTA**: added to bottom of progress view
- **Consistent back button**: verify back affordance exists in contacts + draft sub-views

### 3. Progress view — pacing transparency

Add below chart/stats:

> "We only send 35 connection requests per day during business hours. We do this to keep your account safe."

Add when campaign is running:

> "Next connection in ~X min" (computed from `nextScheduledAt` in chrome.storage.local)

### 4. Fix chart empty state

| Condition | Display |
|---|---|
| `chartData.length === 0`, no pending | "No connections sent yet" |
| `chartData.length === 0`, pending | "First connection coming soon" |
| `chartData.length === 1` (same-day sends) | "X connections sent today" (no chart) |
| `chartData.length >= 2` | Line graph (unchanged) |

Root cause: chart required 2+ data points. If both sends happened on the same day, only 1 data point exists, triggering the wrong empty state.

### 5. Wording

- "Sent" stat label → "Connected"
- "send" anywhere in UI → "connection request" or "connected"
- "Recently sent" → removed from panel

## Out of scope

- Pacing interval change (15-30 min between sends stays as-is)
- Panel navigation/tabs (not needed — flow is sequential)
- Any changes to scanning, results, or launched states
