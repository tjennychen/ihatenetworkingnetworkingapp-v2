# IHN v2 Reliability — Design Doc

**Date:** 2026-03-04
**Goal:** Make LinkedIn connection automation actually reliable. Current state: ~2 successful sends out of ~100 attempts. Root causes are transient timing failures with no retry, and zero diagnostic visibility.

---

## Root Cause Analysis

| Problem | Impact | Current behavior |
|---|---|---|
| No retry on transient failures | High | One timing failure = permanent `failed` status |
| Fixed 800ms timeout after clicking Connect | High | Modal not ready = send button not found |
| Fixed 2500ms tab buffer | Medium | Content script not injected yet = `no_response` |
| No diagnostic trace | High | `send_btn_not_found` gives zero debug info |
| Weekly limit check only after clicking Send | Low | Misses pre-send alert element |
| Minor selector gaps | Low | `nativeClick` not on More button, textarea missing fallback |

---

## Decisions

### Phase 1 — Retry logic + diagnostic trace

**Retry logic**

Add `retry_count` (integer, default 0) column to `connection_queue`.

Two failure categories:

| Transient — retry up to 3x with 3-5 min delay | Permanent — fail immediately |
|---|---|
| `send_btn_not_found` | `already_connected` |
| `no_response` | `already_pending` |
| `connect_not_available` | `wrong_profile` |
| `note_quota_reached` | `weekly_limit_reached` |
| `linkedin_error` (non-limit) | `weekly_limit_reached` |

On transient failure in `processNextQueueItem()`:
- If `retry_count < 3`: increment `retry_count`, set `scheduled_at = NOW() + 3-5 min random`, keep `status = 'pending'`
- If `retry_count >= 3`: set `status = 'failed'`, store error

**Diagnostic trace**

Add `debug_info` (text) column to `connection_queue`.

Inside `sendConnection()`, build a trace object at each critical step:
```
connectBtn=aria|moreOpened=yes|modal=yes|shadowBtn=found|paywall=no
```

Fields:
- `connectBtn` — how found: `aria`, `text`, `menu`, `fallback`, `null`
- `moreOpened` — `yes`, `no`, `skipped`
- `modal` — `yes`, `no` (was dialog present when send button search ran)
- `shadowBtn` — `found`, `null`
- `regularBtn` — `found`, `null`
- `paywall` — `yes`, `no`

Store on every attempt (success and failure). On success this confirms the path that worked. On failure this pinpoints exactly what was null.

`processNextQueueItem()` writes `debug_info` to Supabase on every result.

---

### Phase 2 — Modal polling instead of fixed timeouts

**After clicking Connect — replace `setTimeout(800ms)`**

Poll every 150ms up to 3000ms for modal to appear. Check:
1. `document.querySelector('[role="dialog"]')` — regular DOM dialog
2. `document.querySelector('#interop-outlet')?.shadowRoot` has children — shadow modal

Resolve as soon as either is detected. Fall through after 3s timeout.

Rationale: MutationObserver ruled out — shadow DOM mutations aren't observable from `document.body`, and observers require careful cleanup. Polling is simpler and reliable for this use case.

**Tab load buffer — replace `setTimeout(2500ms)` in `processNextQueueItem()`**

Poll every 500ms up to 12s: send `GET_LINKEDIN_NAME` ping to the tab. Resolve when content script responds. Eliminates `no_response` failures from slow tab loads.

Same approach in `GET_LINKEDIN_NAMES` handler for name enrichment.

---

### Phase 3 — Selector fixes

All changes to `extension/content/linkedin.ts`:

1. `openMoreActionsIfNeeded()` — change `.click()` to `nativeClick()` for consistency
2. Note textarea selector — add `textarea#custom-message` as first option (confirmed 2026)
3. `findConnectButton()` — add `[aria-label*="connect" i]` case-insensitive flag to dropdown `divBtn` query
4. Weekly limit check — add `.ip-fuse-limit-alert` and `#ip-fuse-limit-alert__header` check BEFORE clicking Send (currently only checked after)

---

## Schema Changes

```sql
ALTER TABLE connection_queue ADD COLUMN retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE connection_queue ADD COLUMN debug_info text;
```

---

## Files Changed

| File | Changes |
|---|---|
| `extension/content/linkedin.ts` | Modal polling, selector fixes, trace building |
| `extension/background/service-worker.ts` | Retry logic, tab ping loop, write debug_info |
| Supabase migration | Add retry_count, debug_info columns |

---

## Success Criteria

- Transient failures retry automatically — no manual queue resets needed for timing issues
- `send_btn_not_found` failures drop significantly (polling catches slow modals)
- `no_response` failures drop significantly (ping loop catches slow tab loads)
- Every failed item has `debug_info` explaining exactly what was null
- Next LinkedIn break diagnosed in <10 minutes using debug_info + ihn-ops agent

---

## Out of Scope

- Redesigning queue structure
- Separate logging table
- Playwright / live browser testing
- UI changes
