# IHN v2 Reliability Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make LinkedIn connection automation reliable by adding retry logic, diagnostic tracing, modal polling, and selector fixes.

**Architecture:** Three phases — (1) retry transient failures + store debug traces in Supabase, (2) replace fixed timeouts with polling so modal/tab timing failures disappear, (3) minor selector hardening. All changes are surgical — only the broken parts change.

**Tech Stack:** TypeScript, Chrome Extension MV3, Supabase (PostgREST), esbuild, Jest + jsdom

**Design doc:** `docs/plans/2026-03-04-reliability-design.md`

**Read before starting:**
- `docs/FIXES.md` — regression guard
- `/Users/jenny/.claude/projects/-Users-jenny/memory/linkedin-automation.md` — known bug patterns

---

## Task 1: Supabase schema migration

**Files:**
- No local files — uses mcp__supabase__apply_migration tool

**Step 1: Apply migration**

Use `mcp__supabase__apply_migration` with name `add_retry_count_debug_info` and SQL:

```sql
ALTER TABLE connection_queue ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE connection_queue ADD COLUMN IF NOT EXISTS debug_info text;
```

**Step 2: Verify columns exist**

Use `mcp__supabase__execute_sql`:
```sql
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'connection_queue'
AND column_name IN ('retry_count', 'debug_info');
```

Expected: two rows returned with correct types.

---

## Task 2: Diagnostic trace in `sendConnection()`

**Files:**
- Modify: `extension/content/linkedin.ts`
- Test: `extension/tests/linkedin-trace.test.ts` (create)

**Step 1: Write failing test**

Create `extension/tests/linkedin-trace.test.ts`:

```typescript
/**
 * @jest-environment jsdom
 */

// Minimal chrome mock
(global as any).chrome = {
  storage: { local: { get: jest.fn(), set: jest.fn() } },
  runtime: { onMessage: { addListener: jest.fn() } }
}

// Import the trace builder we'll extract
// After implementation, linkedin.ts will export buildTrace for testing
import { buildTrace } from '../content/linkedin'

describe('buildTrace', () => {
  it('records null connectBtn', () => {
    const t = buildTrace()
    t.set('connectBtn', 'null')
    expect(t.toString()).toBe('connectBtn=null')
  })

  it('records multiple fields', () => {
    const t = buildTrace()
    t.set('connectBtn', 'aria')
    t.set('modal', 'yes')
    t.set('shadowBtn', 'null')
    expect(t.toString()).toBe('connectBtn=aria|modal=yes|shadowBtn=null')
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npx jest tests/linkedin-trace.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `buildTrace` not exported.

**Step 3: Add `buildTrace` and wire into `sendConnection()`**

In `extension/content/linkedin.ts`, add after the `nativeClick` function:

```typescript
export function buildTrace() {
  const fields: string[] = []
  return {
    set(key: string, val: string) { fields.push(`${key}=${val}`) },
    toString() { return fields.join('|') }
  }
}
```

In `sendConnection()`, add at the top of the function body (after the `!window.location.pathname` check):

```typescript
const trace = buildTrace()
```

Then add trace calls at each key step. After `findConnectButton()` first attempt:
```typescript
// existing: let connectBtn = findConnectButton()
trace.set('connectBtn', connectBtn ? 'direct' : 'null')
```

After `openMoreActionsIfNeeded()`:
```typescript
// existing: connectBtn = findConnectButton()
trace.set('moreOpened', connectBtn ? 'yes' : 'no')
```

After `dismissPremiumPaywall()`:
```typescript
// existing: await dismissPremiumPaywall()
trace.set('paywall', 'checked')
```

Before the shadow DOM send button search:
```typescript
const modalPresent = !!document.querySelector('[role="dialog"]') ||
  !!(document.querySelector('#interop-outlet') as HTMLElement | null)?.shadowRoot?.childElementCount
trace.set('modal', modalPresent ? 'yes' : 'no')
```

After the shadow DOM check:
```typescript
trace.set('shadowBtn', shadowSendBtn ? 'found' : 'null')
trace.set('regularBtn', sendBtn && !shadowSendBtn ? 'found' : 'null')
```

Update the return values to include trace:
```typescript
// Change all returns to include trace
if (!sendBtn) {
  return { success: false, error: 'send_btn_not_found', trace: trace.toString() }
}
// ...
return { success: true, trace: trace.toString() }
```

Also update the `sendConnection` return type:
```typescript
async function sendConnection(note?: string, expectedName?: string): Promise<{ success: boolean; error?: string; trace?: string }>
```

**Step 4: Run test to confirm it passes**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npx jest tests/linkedin-trace.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

**Step 5: Commit**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npm run build 2>&1 | tail -5
```

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2" && git add extension/content/linkedin.ts extension/tests/linkedin-trace.test.ts && git commit -m "$(cat <<'EOF'
feat: add diagnostic trace to sendConnection

Records connectBtn source, modal presence, shadow/regular send button
result at each step. Returned in result.trace for storage in Supabase.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Retry logic in `processNextQueueItem()`

**Files:**
- Modify: `extension/background/service-worker.ts`

No unit tests here — chrome API and Supabase are too tightly coupled. Manual verification in Step 5.

**Step 1: Define transient vs permanent error sets**

At the top of `service-worker.ts`, after the imports, add:

```typescript
const TRANSIENT_ERRORS = new Set([
  'send_btn_not_found',
  'no_response',
  'connect_not_available',
  'note_quota_reached',
  'linkedin_error',
])
```

**Step 2: Update the failure handling block**

In `processNextQueueItem()`, find the `else` block that handles failures (currently sets `status: 'failed'`). Replace it entirely:

```typescript
} else {
  const isTransient = TRANSIENT_ERRORS.has(result.error ?? '')
  const currentRetry = item.retry_count ?? 0

  if (isTransient && currentRetry < 3) {
    // Requeue with short delay — keep status pending
    const retryDelay = (3 + Math.random() * 2) * 60000 // 3-5 min
    await supabase.from('connection_queue').update({
      retry_count: currentRetry + 1,
      scheduled_at: new Date(Date.now() + retryDelay).toISOString(),
      debug_info: result.trace ?? null,
    }).eq('id', item.id)
    console.log(`[IHN] Transient failure (attempt ${currentRetry + 1}/3): ${result.error}`)
  } else {
    // Permanent failure or retry limit reached
    await supabase.from('connection_queue').update({
      status: 'failed',
      error: result.error ?? 'unknown',
      debug_info: result.trace ?? null,
    }).eq('id', item.id)
    // Schedule next item with human-like delay even after failures
    const failDelayMinutes = 8 + Math.random() * 12
    const nextFailAt = new Date(Date.now() + failDelayMinutes * 60000).toISOString()
    const { data: nextFailItem } = await supabase
      .from('connection_queue').select('id').eq('user_id', session.user.id)
      .eq('status', 'pending').order('created_at', { ascending: true }).limit(1).single()
    if (nextFailItem) {
      await supabase.from('connection_queue').update({ scheduled_at: nextFailAt }).eq('id', nextFailItem.id)
    }
    const { queuePending: storedPending } = await chrome.storage.local.get('queuePending')
    await chrome.storage.local.set({ queuePending: Math.max(0, (storedPending ?? 1) - 1) })
  }
}
```

**Step 3: Also write debug_info on success**

In the success block, add `debug_info` to the update:
```typescript
await supabase.from('connection_queue').update({
  status: 'sent',
  sent_at: sentAt,
  debug_info: result.trace ?? null,
}).eq('id', item.id)
```

**Step 4: Build**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npm run build 2>&1 | tail -5
```

Expected: no errors.

**Step 5: Manual verification query**

After reloading the extension and letting it run on one item, check:
```sql
SELECT status, retry_count, error, debug_info, updated_at
FROM connection_queue
ORDER BY updated_at DESC
LIMIT 5;
```

Expected: `debug_info` populated, `retry_count` incrementing on transient failures instead of going to `failed`.

**Step 6: Commit**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2" && git add extension/background/service-worker.ts && git commit -m "$(cat <<'EOF'
feat: retry transient failures up to 3x, store debug trace

Transient errors (send_btn_not_found, no_response, connect_not_available)
now retry with 3-5 min delay instead of immediately marking failed.
debug_info written to Supabase on every attempt.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Modal polling — replace fixed timeouts

**Files:**
- Modify: `extension/content/linkedin.ts`
- Test: `extension/tests/wait-for-modal.test.ts` (create)

**Step 1: Write failing test**

Create `extension/tests/wait-for-modal.test.ts`:

```typescript
/**
 * @jest-environment jsdom
 */

(global as any).chrome = {
  storage: { local: { get: jest.fn(), set: jest.fn() } },
  runtime: { onMessage: { addListener: jest.fn() } }
}

import { waitForModal } from '../content/linkedin'

describe('waitForModal', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  it('resolves immediately when dialog already present', async () => {
    document.body.innerHTML = '<div role="dialog">modal</div>'
    const p = waitForModal(3000)
    jest.runAllTimers()
    await expect(p).resolves.toBe(true)
  })

  it('resolves when dialog appears after delay', async () => {
    document.body.innerHTML = ''
    const p = waitForModal(3000)
    // Simulate modal appearing after 300ms
    setTimeout(() => {
      document.body.innerHTML = '<div role="dialog">modal</div>'
    }, 300)
    jest.runAllTimers()
    await expect(p).resolves.toBe(true)
  })

  it('resolves false after timeout with no modal', async () => {
    document.body.innerHTML = ''
    const p = waitForModal(3000)
    jest.runAllTimers()
    await expect(p).resolves.toBe(false)
  })
})
```

**Step 2: Run test to confirm it fails**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npx jest tests/wait-for-modal.test.ts --no-coverage 2>&1 | tail -20
```

Expected: FAIL — `waitForModal` not exported.

**Step 3: Add `waitForModal` to `linkedin.ts`**

Add after `buildTrace`:

```typescript
export function waitForModal(timeoutMs = 3000): Promise<boolean> {
  return new Promise(resolve => {
    const interval = 150
    let elapsed = 0
    const check = () => {
      const hasDialog = !!document.querySelector('[role="dialog"]')
      const hasShadow = !!(document.querySelector('#interop-outlet') as HTMLElement | null)
        ?.shadowRoot?.childElementCount
      if (hasDialog || hasShadow) { resolve(true); return }
      elapsed += interval
      if (elapsed >= timeoutMs) { resolve(false); return }
      setTimeout(check, interval)
    }
    check()
  })
}
```

**Step 4: Replace `setTimeout(800)` in `sendConnection()`**

Find this line in `sendConnection()`:
```typescript
await new Promise(r => setTimeout(r, 800 + Math.random() * 700))
```
(the one right after `nativeClick(connectBtn)`)

Replace with:
```typescript
await waitForModal(3000)
```

Also replace the retry-connect wait (inside the note quota block):
```typescript
await new Promise(r => setTimeout(r, 800 + Math.random() * 500))
```
Replace with:
```typescript
await waitForModal(2000)
```

**Step 5: Run test to confirm it passes**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npx jest tests/wait-for-modal.test.ts --no-coverage 2>&1 | tail -10
```

Expected: PASS

**Step 6: Build**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npm run build 2>&1 | tail -5
```

**Step 7: Commit**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2" && git add extension/content/linkedin.ts extension/tests/wait-for-modal.test.ts && git commit -m "$(cat <<'EOF'
feat: replace fixed modal timeout with polling

waitForModal() polls every 150ms up to 3s for [role="dialog"] or
#interop-outlet shadow content. Eliminates timing failures from
slow LinkedIn React rendering.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Tab ping loop — replace fixed 2500ms buffer

**Files:**
- Modify: `extension/background/service-worker.ts`

**Step 1: Add `waitForContentScript` helper**

In `service-worker.ts`, add before `processNextQueueItem`:

```typescript
async function waitForContentScript(tabId: number, timeoutMs = 12000): Promise<boolean> {
  const interval = 500
  let elapsed = 0
  while (elapsed < timeoutMs) {
    const ready = await new Promise<boolean>(resolve => {
      chrome.tabs.sendMessage(tabId, { type: 'GET_LINKEDIN_NAME' }, response => {
        resolve(!chrome.runtime.lastError && !!response)
      })
    })
    if (ready) return true
    await new Promise(r => setTimeout(r, interval))
    elapsed += interval
  }
  return false
}
```

**Step 2: Replace 2500ms buffer in `processNextQueueItem()`**

Find:
```typescript
setTimeout(resolve, 2500) // buffer for LinkedIn JS to render
```

Replace with — after the `chrome.tabs.onUpdated` listener resolves, replace the whole wait block:

```typescript
// After the onUpdated listener resolves (tab status === complete):
setTimeout(resolve, 500) // minimal buffer before pinging
```

Then after the tab load wait block, add:
```typescript
const ready = await waitForContentScript(tabId)
if (!ready) {
  await chrome.tabs.remove(tabId).catch(() => {})
  // Requeue with 5 min delay
  await supabase.from('connection_queue').update({
    scheduled_at: new Date(Date.now() + 5 * 60000).toISOString(),
  }).eq('id', item.id)
  return
}
```

**Step 3: Build**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npm run build 2>&1 | tail -5
```

**Step 4: Commit**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2" && git add extension/background/service-worker.ts && git commit -m "$(cat <<'EOF'
feat: replace fixed tab buffer with content script ping loop

waitForContentScript() pings tab every 500ms up to 12s before sending
CONNECT message. Eliminates no_response failures from slow tab loads.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Selector fixes

**Files:**
- Modify: `extension/content/linkedin.ts`

Four small changes — do all in one edit pass.

**Step 1: Fix 1 — `nativeClick` on More button**

In `openMoreActionsIfNeeded()`, find:
```typescript
moreBtn.click()
```
Replace with:
```typescript
nativeClick(moreBtn)
```

**Step 2: Fix 2 — add `textarea#custom-message` to note textarea**

In `sendConnection()`, find the textarea selector:
```typescript
const textarea = document.querySelector<HTMLTextAreaElement>(
  'textarea[name="message"], textarea[id*="note"], [class*="connect-button"] textarea, textarea'
)
```
Replace with:
```typescript
const textarea = document.querySelector<HTMLTextAreaElement>(
  'textarea#custom-message, textarea[name="message"], textarea[id*="note"], [class*="connect-button"] textarea, textarea'
)
```

**Step 3: Fix 3 — case-insensitive Connect aria-label in dropdown**

In `findConnectButton()`, find:
```typescript
const divBtn = openMenu.querySelector<HTMLElement>(
  'div[role="button"][aria-label*="Invite"][aria-label*="connect"], div[role="button"][aria-label*="connect" i]'
)
```
This line already has the `i` flag — verify it's present. If the second selector is missing the `i` flag, add it. No change needed if already correct.

**Step 4: Fix 4 — weekly limit pre-check**

In `sendConnection()`, before `nativeClick(sendBtn)`, add:

```typescript
// Pre-click weekly limit check — catches alert that appears before send
const preSendLimit = document.querySelector('.ip-fuse-limit-alert, #ip-fuse-limit-alert__header')
if (preSendLimit) {
  return { success: false, error: 'weekly_limit_reached', trace: trace.toString() }
}
```

**Step 5: Build and run all tests**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/extension" && npm run build 2>&1 | tail -5 && npx jest --no-coverage 2>&1 | tail -15
```

Expected: build clean, all tests pass.

**Step 6: Commit**

```bash
cd "/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2" && git add extension/content/linkedin.ts && git commit -m "$(cat <<'EOF'
fix: selector hardening — nativeClick More, textarea fallback, weekly limit pre-check

- nativeClick on More/Resources button (was .click())
- Add textarea#custom-message as first note textarea selector
- Pre-send weekly limit check via .ip-fuse-limit-alert
- Verify case-insensitive Connect aria-label in dropdown

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Reload and verify end-to-end

**Step 1: Reload extension in Chrome**

1. Go to `chrome://extensions`
2. Find "I Hate Networking" — click the circular reload icon
3. Close and reopen the side panel

**Step 2: Reset a few pending items to test immediately**

```sql
UPDATE connection_queue
SET scheduled_at = NOW(), retry_count = 0
WHERE status = 'pending'
AND scheduled_at > NOW()
LIMIT 3;
```

**Step 3: Watch the queue**

Wait 2-3 minutes, then run:
```sql
SELECT status, retry_count, error, debug_info, updated_at
FROM connection_queue
ORDER BY updated_at DESC
LIMIT 10;
```

Expected:
- Items processing (not all stuck as pending)
- `debug_info` populated on attempted items
- Transient failures show `retry_count = 1` not `status = failed`

**Step 4: Update FIXES.md and linkedin-automation.md**

Using `Edit` tool, add entries for:
- Retry logic pattern (transient vs permanent errors)
- `waitForModal()` polling pattern
- `debug_info` trace format

---

## Verification Checklist

- [ ] `retry_count` and `debug_info` columns exist in Supabase
- [ ] `debug_info` populated on every queue attempt
- [ ] Transient failures retry up to 3x before marking failed
- [ ] Queue processes items after extension reload
- [ ] All existing tests still pass
- [ ] Build has no TypeScript errors
