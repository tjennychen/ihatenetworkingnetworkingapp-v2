# Delta Scan Design

**Date:** 2026-03-12
**Status:** Approved

## Problem

Re-scanning a Luma event re-enriches every attendee, including people already in the DB. For large events (300+ guests), the individual profile fetch phase makes re-scan slow. The sidepanel also shows nothing until the full scan completes, even though cached contact data is already available.

## Goal

1. Show cached contacts immediately when re-scanning a previously scanned event.
2. Only enrich contacts not already in the DB (delta scan).
3. Degrade gracefully for non-logged-in users (fall through to full scan).

## Out of Scope

- Stopping the scroll phase early (too fragile with Luma's dynamic modal).
- Re-enriching existing contacts to pick up new LinkedIn handles (not worth the complexity).
- The "5 consecutive failures = auto-pause" behavior (separate concern).

---

## Architecture

### What Changes

**Sidepanel (`sidepanel.ts`)**

Today, `GET_EVENT_BY_URL` returns `contacts` in its response but the sidepanel discards it — the typed annotation only reads `{ eventId, existingUrls, linkedInCount }`. This must be fixed as part of this work.

Required changes:
- Widen the type annotation for the `GET_EVENT_BY_URL` response to include `contacts: any[]`.
- Add `contacts: any[]` and `existingUrls: string[]` fields to the `already_scanned` variant of `ScanState`.
- Store `contacts` and `existingUrls` when setting `already_scanned` state.
- Render cached contacts immediately in the `already_scanned` view (same contact list view used in `results` state).
- Update `startScan` call site: pass `scanState.existingUrls` into the `START_SCAN` message so the content script receives it. `startScan` is called from `btnRescan`'s click handler which fires while `scanState.type === 'already_scanned'`.
- Add a module-level `cachedContacts: any[]` variable (initialized to `[]`). When `btnRescan` fires (while `scanState.type === 'already_scanned'`), store `scanState.contacts` into `cachedContacts` before calling `startScan`. Clear `cachedContacts` on `SCAN_COMPLETE` (after re-fetching) and on scan error.
- The `scanning` state render branch checks `cachedContacts.length > 0` and, if so, emits the contact list below the progress bar. This keeps the existing `scanning` state type unchanged — no new fields needed on `ScanState`.
- This gives the composite view: existing `scanning` progress UI at top + cached contacts below.
- On `SCAN_COMPLETE`, re-fetch via `GET_EVENT_BY_URL` to get the merged contact list. Show "+ N new contacts found" if `newCount > 0`, dismiss silently otherwise.
- After delta scan completes when `hasCampaign` is already true: stay on the contact list view (do not navigate away). The "+ N new" indicator is enough; no extra state needed.

**Content script (`luma.ts`)**

- `START_SCAN` message listener receives `existingUrls: string[]` (may be empty for first scan or non-logged-in).
- Build `existingUrlsSet = new Set(existingUrls)` for O(1) lookup.
- After scraping all attendees, compute `newContacts = all.filter(c => !existingUrlsSet.has(c.url))`.
- URL comparison must use the same `normalizeProfileUrl()` normalization applied during scraping — `existingUrls` from DB were stored using the same normalization, but this assumption should be verified at the comparison site.
- Enrichment phase (individual profile fetch) runs only for `newContacts`.
- `START_ENRICHMENT` sends only `newContacts` (empty array if no new attendees — service worker handles this as a no-op).
- `SCAN_COMPLETE` message adds `newCount: number` (length of `newContacts`).

**Service worker (`service-worker.ts`)**

- No logic changes. Upsert on `(event_id, luma_profile_url)` already handles new contacts correctly.
- `GET_EVENT_BY_URL` already returns `contacts` in its response — no schema change needed.

---

## Data Flow

### Full scan (first time or not logged in)

```
existingUrls = []
→ content script enriches all attendees
→ START_ENRICHMENT (all contacts)
→ SCAN_COMPLETE { newCount: all.length }
→ sidepanel shows results
```

### Delta scan (re-scan, logged in)

```
existingUrls = [47 known URLs from DB]
→ sidepanel immediately renders 47 cached contacts
→ content script scrolls full guest list (52 total)
→ newContacts = 52 - 47 = 5
→ enrichment runs for 5 contacts only
→ START_ENRICHMENT (5 contacts)
→ service worker upserts 5 new rows
→ SCAN_COMPLETE { newCount: 5 }
→ sidepanel re-fetches from DB (52 contacts total)
→ shows "+ 5 new contacts found"
```

### Zero new attendees

```
existingUrls = [52 known URLs]
→ sidepanel renders 52 cached contacts
→ content script finds 52 attendees, newContacts = []
→ START_ENRICHMENT ([]) → no-op
→ SCAN_COMPLETE { newCount: 0 }
→ sidepanel dismisses progress indicator silently
```

### Delta scan with active campaign

```
hasCampaign = true, existingUrls = [47 known URLs]
→ sidepanel renders 47 cached contacts + campaign progress
→ delta scan finds 5 new contacts
→ SCAN_COMPLETE { newCount: 5 }
→ sidepanel re-fetches, shows updated contact list with "+ 5 new"
→ stays on contact list view (no navigation)
→ user can re-launch campaign; launchCampaign deduplication skips already-sent contacts
```

---

## Sidepanel UX States

| State | What user sees |
|-------|---------------|
| `already_scanned` (updated) | Cached contact list + "Scan for new attendees" button |
| During delta scan | Existing contact list + existing scanning progress UI (done/total/currentName, smaller total) |
| Delta scan complete, new found | "+ N new contacts found" indicator, updated contact list |
| Delta scan complete, none found | Progress clears silently, contact list unchanged |

---

## Graceful Degradation

- Not logged in → `GET_EVENT_BY_URL` returns no contacts → `existingUrls = []` → full scan runs as before, no UX change.
- `already_scanned` state is unreachable without a prior logged-in scan, so the immediate-render path is never entered without cached data.

---

## What Does NOT Change

- Duplicate send protection: `launchCampaign` already skips contacts with `status = 'sent'` or `'accepted'` in `connection_queue`. No change needed.
- Scroll phase: still scrolls the full guest list (required to discover new attendees).
- Contact data quality: existing contacts are not re-enriched. If a contact's LinkedIn URL was missing on first scan and Luma now has it via API interception, the upsert will update it (API interception still runs for all attendees regardless of `existingUrls`).
- Progress rendering: existing `scanning` state UI is reused as-is. The `total` count is simply smaller (new contacts only), so progress moves faster without custom copy.
