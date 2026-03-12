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

- `GET_EVENT_BY_URL` already returns `contacts: Contact[]` — use this data.
- In `already_scanned` state, render cached contacts immediately (same contact list view used in `results` state).
- "Scan for new attendees" button starts delta scan. During scan, show inline progress above the contact list. Existing contacts remain visible.
- On `SCAN_COMPLETE`, re-fetch via `GET_EVENT_BY_URL` to get the merged contact list. Show "+ N new contacts found" if `newCount > 0`, dismiss silently otherwise.
- `ScanState.already_scanned` gains a `contacts` field to hold the cached data.

**Content script (`luma.ts`)**

- `START_SCAN` message gains `existingUrls: string[]` (normalized Luma profile URLs already in DB).
- After scraping all attendees from page, compute `newContacts = all.filter(c => !existingUrlsSet.has(c.url))`.
- Enrichment phase (individual profile fetch) runs only for `newContacts`.
- `START_ENRICHMENT` sends only `newContacts` (empty array if no new attendees).
- `SCAN_COMPLETE` message adds `newCount: number` (count of new contacts found).

**Service worker (`service-worker.ts`)**

- No logic changes. Upsert on `(event_id, luma_profile_url)` already handles new contacts correctly.
- `GET_EVENT_BY_URL` response already includes `contacts` — no schema change needed.

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

---

## Sidepanel UX States

| State | What user sees |
|-------|---------------|
| `already_scanned` (new) | Cached contact list + "Scan for new attendees" button |
| During delta scan | Contact list + inline progress bar: "Checking for new attendees... 12/47" |
| Delta scan complete, new found | "+ N new contacts found" toast/badge, updated contact list |
| Delta scan complete, none found | Progress clears silently, contact list unchanged |

---

## Graceful Degradation

- Not logged in → `GET_EVENT_BY_URL` returns no contacts → `existingUrls = []` → full scan runs as before.
- `already_scanned` state is unreachable without a prior logged-in scan, so the immediate-render path is never entered without cached data.

---

## What Does NOT Change

- Duplicate send protection: `launchCampaign` already skips contacts with `status = 'sent'` or `'accepted'` in `connection_queue`. No change needed.
- Scroll phase: still scrolls the full guest list (required to discover new attendees).
- Contact data quality: existing contacts are not re-enriched. If a contact's LinkedIn URL was missing on first scan and Luma now has it via API response, the upsert will update it (API interception still runs for all attendees).
