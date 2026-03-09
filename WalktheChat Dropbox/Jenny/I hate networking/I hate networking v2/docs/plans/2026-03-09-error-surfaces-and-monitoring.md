# Error Surfaces & Monitoring Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Give users actionable error messages when scans/connections fail, and give the operator (Jenny) early warning when Luma/LinkedIn changes break things across all users.

**Architecture:** Log structured diagnostics from every scan + connection attempt to Supabase. Show specific, actionable error messages in the sidepanel instead of silent failures. Auto-pause campaigns when connection failures spike. Extend existing pg_cron monitor to check scan health and flag anomalies.

**Tech Stack:** Supabase (Postgres + pg_cron), Chrome extension (TypeScript, esbuild), existing tables + new `scan_log` table.

**Build files:** `sidepanel/sidepanel.ts`, `background/service-worker.ts`, `content/luma.ts`, `content/linkedin.ts` (confirm via `extension/package.json` build script).

---

### Task 1: Create `scan_log` table in Supabase

**Files:**
- Supabase migration (via `mcp__supabase__apply_migration`)

**Step 1: Apply migration**

```sql
CREATE TABLE public.scan_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users(id),
  event_url     text,
  event_name    text DEFAULT '',
  button_found  boolean DEFAULT false,
  modal_found   boolean DEFAULT false,
  api_guests    integer DEFAULT 0,
  dom_guests    integer DEFAULT 0,
  total_contacts integer DEFAULT 0,
  linkedin_count integer DEFAULT 0,
  error_type    text DEFAULT '',
  debug_details jsonb DEFAULT '{}'::jsonb,
  created_at    timestamptz DEFAULT now()
);

-- RLS: users can insert their own rows, operator can read all
ALTER TABLE public.scan_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users insert own scan logs"
  ON public.scan_log FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users read own scan logs"
  ON public.scan_log FOR SELECT
  USING (auth.uid() = user_id);
```

**Step 2: Verify table exists**

Run: `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'scan_log' ORDER BY ordinal_position;`

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: create scan_log table for structured scan diagnostics"
```

---

### Task 2: Send scan diagnostics from luma.ts content script

**Files:**
- Modify: `extension/content/luma.ts` — the `runScan()` function (lines 385-548)

The content script already collects most diagnostic data but only includes `scanDebug` when `contacts.length === 0`. Change it to ALWAYS send diagnostics.

**Step 1: Replace the scanDebug block at the end of runScan()**

Find (luma.ts, around line 539-548):
```typescript
  const scanDebug = contacts.length === 0 ? {
    eventUrl: lumaUrl,
    buttonClicked,
    buttonTexts: allBtnTexts,
    preClickLinks: preClickLinks.size,
    apiGuestsFound: apiGuests.length,
    hostLinksFound: hostProfileUrls.length,
  } : undefined

  chrome.runtime.sendMessage({ type: 'SCAN_COMPLETE', eventId: saveResult.eventId, total: actualTotal, found: actualFound, contacts, scanDebug })
```

Replace with:
```typescript
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
```

**Step 2: Build and verify**

Run: `cd extension && npm run build`
Expected: no errors

**Step 3: Commit**

```bash
git add extension/content/luma.ts extension/dist/luma.js
git commit -m "feat: always send scan diagnostics from luma content script"
```

---

### Task 3: Log scan diagnostics to Supabase from service-worker

**Files:**
- Modify: `extension/background/service-worker.ts` — add `LOG_SCAN` message handler

**Step 1: Add LOG_SCAN handler in the onMessage listener block** (after the SIGN_UP handler, around line 133)

```typescript
  if (msg.type === 'LOG_SCAN') {
    getSession().then(async (session) => {
      if (!session) { sendResponse({ ok: false }); return }
      const supabase = getAuthedSupabase(session.access_token)
      const d = msg.data
      await supabase.from('scan_log').insert({
        user_id: session.user.id,
        event_url: d.eventUrl || '',
        event_name: d.eventName || '',
        button_found: !!d.buttonClicked,
        modal_found: !!d.modalFound,
        api_guests: d.apiGuestsCount ?? 0,
        dom_guests: d.domGuestsCount ?? 0,
        total_contacts: d.totalContacts ?? 0,
        linkedin_count: d.linkedInCount ?? 0,
        error_type: d.errorType || '',
        debug_details: {
          buttonTexts: d.buttonTexts || [],
          preClickLinks: d.preClickLinks ?? 0,
          apiHadSocial: !!d.apiHadSocial,
        },
      })
      sendResponse({ ok: true })
    })
    return true
  }
```

**Step 2: Trigger LOG_SCAN from sidepanel when SCAN_COMPLETE arrives**

In `sidepanel.ts`, find where SCAN_COMPLETE is handled in the message listener. Add a `LOG_SCAN` call there so we log every scan result:

Find the SCAN_COMPLETE handler (search for `msg.type === 'SCAN_COMPLETE'` or `type: 'SCAN_COMPLETE'`) and after updating scanState, add:

```typescript
    // Log scan diagnostics to Supabase
    if (msg.scanDebug) {
      chrome.runtime.sendMessage({
        type: 'LOG_SCAN',
        data: {
          ...msg.scanDebug,
          eventName: msg.eventName ?? scanState.eventName ?? '',
          totalContacts: msg.total,
          linkedInCount: msg.found,
          errorType: msg.total === 0 ? 'no_contacts' : msg.found === 0 ? 'no_linkedin' : '',
        },
      })
    }
```

NOTE: Before editing, search sidepanel.ts for where SCAN_COMPLETE messages are received. It may be in the `chrome.runtime.onMessage.addListener` block. Read that section carefully to find the exact insertion point.

**Step 3: Build and verify**

Run: `cd extension && npm run build`

**Step 4: Commit**

```bash
git add extension/background/service-worker.ts extension/sidepanel/sidepanel.ts extension/dist/service-worker.js extension/dist/sidepanel.js
git commit -m "feat: log scan diagnostics to scan_log table via service worker"
```

---

### Task 4: User-facing error messages for scan failures

**Files:**
- Modify: `extension/sidepanel/sidepanel.ts` — the results view when `s.total === 0` (around line 926-946)
- Modify: `extension/content/luma.ts` — include scanDebug in SCAN_COMPLETE message (already done in Task 2)

Currently when 0 attendees are found, the user sees: "The guest list may be hidden on this event." This is always the same message regardless of what actually went wrong.

**Step 1: Pass scanDebug into scanState**

Find where SCAN_COMPLETE updates scanState (in sidepanel.ts message listener). Ensure `scanDebug` is stored. The `ScanState` type for `results` needs a `scanDebug` field.

Update the `ScanState` type (around line 19):
```typescript
  | { type: 'results'; found: number; total: number; eventId: string; eventName: string; contacts: any[]; scanDebug?: any }
```

And where scanState is set on SCAN_COMPLETE, include `scanDebug: msg.scanDebug`.

**Step 2: Show specific error messages when total === 0**

Replace the 0-attendees block (sidepanel.ts around line 926-946):

```typescript
    if (s.total === 0) {
      const d = (s as any).scanDebug
      let errorMsg = 'The guest list may be hidden on this event. Try scrolling down to load the Guests section first, then scan again.'
      if (d && !d.buttonClicked) {
        errorMsg = 'Could not find the guest list button. Luma may have changed their page layout. Try refreshing the page and scanning again.'
      } else if (d && d.buttonClicked && !d.modalFound) {
        errorMsg = 'Found the guest button but the attendee list did not load. Try scrolling down on the event page first, then scan again.'
      } else if (d && d.buttonClicked && d.modalFound && d.apiGuestsCount === 0 && d.domGuestsCount === 0) {
        errorMsg = 'Opened the guest list but could not read any attendees. Luma may have changed their page structure.'
      }
      root.innerHTML = `
        <div class="compact-header">
          <div class="compact-brand">
            <img src="../icons/icon48.png" class="compact-logo" alt="">
            <span class="compact-name">I Hate Networking</span>
          </div>
        </div>
        <div class="section" style="text-align:center;padding:32px 20px;">
          <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:8px;">No attendees found</div>
          <p style="font-size:13px;color:#9ca3af;line-height:1.5;margin:0 0 20px;">${errorMsg}</p>
          <button class="btn btn-secondary" id="btnTryAgain">Try again</button>
        </div>
        <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
      `
      document.getElementById('btnTryAgain')?.addEventListener('click', () => {
        scanState = { type: 'idle' }
        render()
      })
      return
    }
```

**Step 3: Add message when contacts found but 0 LinkedIn**

After the `s.total === 0` block, add a check for `s.found === 0 && s.total > 0`:

```typescript
    if (s.found === 0 && s.total > 0) {
      root.innerHTML = `
        <div class="compact-header">
          <div class="compact-brand">
            <img src="../icons/icon48.png" class="compact-logo" alt="">
            <span class="compact-name">I Hate Networking</span>
          </div>
        </div>
        <div class="section" style="text-align:center;padding:32px 20px;">
          <div style="font-size:15px;font-weight:600;color:#374151;margin-bottom:8px;">No LinkedIn profiles found</div>
          <p style="font-size:13px;color:#9ca3af;line-height:1.5;margin:0 0 12px;">Found ${s.total} attendees but none had LinkedIn profiles linked on Luma.</p>
          <a href="#" id="btnDownloadCsvEmpty" style="font-size:12px;color:#6b7280;text-decoration:underline;">Download CSV of attendees</a>
          <div style="margin-top:16px;"><button class="btn btn-secondary" id="btnTryAgain2">Back</button></div>
        </div>
        <div class="byline">by <a href="https://www.linkedin.com/in/tingyi-jenny-chen" target="_blank">Jenny Chen</a></div>
      `
      document.getElementById('btnTryAgain2')?.addEventListener('click', () => {
        scanState = { type: 'idle' }
        render()
      })
      // Wire CSV download using the same logic as the main results view
      document.getElementById('btnDownloadCsvEmpty')?.addEventListener('click', (e) => {
        e.preventDefault()
        const rows = [['Name', 'LinkedIn', 'Instagram', 'Twitter', 'Website', 'Luma Profile']]
        for (const c of s.contacts) {
          rows.push([c.name, c.linkedInUrl, c.instagramUrl ?? '', c.twitterUrl ?? '', c.websiteUrl ?? '', c.url])
        }
        const csv = rows.map(r => r.map(v => `"${(v || '').replace(/"/g, '""')}"`).join(',')).join('\n')
        const blob = new Blob([csv], { type: 'text/csv' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${s.eventName || 'attendees'}.csv`
        a.click()
      })
      return
    }
```

**Step 4: Build and verify**

Run: `cd extension && npm run build`

**Step 5: Commit**

```bash
git add extension/sidepanel/sidepanel.ts extension/dist/sidepanel.js
git commit -m "feat: show specific error messages for scan failures instead of generic text"
```

---

### Task 5: Auto-pause campaign on connection failure spikes

**Files:**
- Modify: `extension/background/service-worker.ts` — `processNextQueueItem()` (around line 616)

When connections fail 5 times in a row, auto-pause and store the reason so the sidepanel can show it.

**Step 1: Track consecutive failures in chrome.storage.local**

At the TOP of `processNextQueueItem()`, after the `campaignPaused` check (around line 622), add:

```typescript
  const { consecutiveFailures: prevFailures } = await chrome.storage.local.get('consecutiveFailures')
  const consecutiveFailures = prevFailures ?? 0
```

In the SUCCESS branch (around line 696), reset the counter:

```typescript
    await chrome.storage.local.set({ consecutiveFailures: 0 })
```

In the FAILURE branch (the `else` block around line 737), increment and check:

```typescript
    const newFailCount = consecutiveFailures + 1
    await chrome.storage.local.set({ consecutiveFailures: newFailCount })

    if (newFailCount >= 5) {
      await chrome.storage.local.set({
        campaignPaused: true,
        pauseReason: `Auto-paused: ${newFailCount} connections failed in a row. Last error: ${result.error ?? 'unknown'}`,
      })
      updateBadge()
    }
```

**Step 2: Show pause reason in sidepanel**

In the campaign view rendering in `sidepanel.ts`, where the paused state is shown, check for `pauseReason` in storage and display it. Find where paused campaigns are rendered and add:

```typescript
// After getting queue status, also get pauseReason
const { pauseReason } = await chrome.storage.local.get('pauseReason')
```

Then in the paused UI, if `pauseReason` exists, show it:
```html
<div style="font-size:12px;color:#ef4444;margin-top:8px;">${escHtml(pauseReason)}</div>
```

When the user resumes, clear the pause reason. In the RESUME_CAMPAIGN handler in service-worker.ts (line 264), add:
```typescript
    chrome.storage.local.set({ campaignPaused: false, pauseReason: '', consecutiveFailures: 0 }).then(() => updateBadge())
```

Also clear on RESUME_CAMPAIGN handler (line 264-268).

**Step 3: Build and verify**

Run: `cd extension && npm run build`

**Step 4: Commit**

```bash
git add extension/background/service-worker.ts extension/sidepanel/sidepanel.ts extension/dist/service-worker.js extension/dist/sidepanel.js
git commit -m "feat: auto-pause campaign after 5 consecutive connection failures"
```

---

### Task 6: Extend pg_cron monitor with scan health + alerts

**Files:**
- Supabase migration

**Step 1: Create alerts table**

```sql
CREATE TABLE public.monitor_alerts (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  message    text NOT NULL,
  details    jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);
```

**Step 2: Update ihn_queue_monitor() to check scan health**

```sql
CREATE OR REPLACE FUNCTION public.ihn_queue_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resets      integer;
  v_sent        integer;
  v_failed      integer;
  v_pending     integer;
  v_top_errors  jsonb;
  v_scan_total  integer;
  v_scan_empty  integer;
  v_scan_rate   numeric;
  v_fail_rate   numeric;
BEGIN
  -- Existing: reset transient failures
  WITH reset_rows AS (
    UPDATE connection_queue
    SET status      = 'pending',
        error       = '',
        retry_count = 0,
        scheduled_at = NOW()
    WHERE status = 'failed'
      AND (
        error IN (
          'send_unverified',
          'paywall_loop',
          'paywall_no_connect',
          'send_btn_not_found',
          'connect_not_available',
          'no_response',
          'linkedin_error'
        )
        OR error LIKE 'wrong_connect_modal%'
        OR error LIKE 'linkedin_error:%'
      )
      AND scheduled_at > NOW() - INTERVAL '24 hours'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_resets FROM reset_rows;

  SELECT COUNT(*) INTO v_sent    FROM connection_queue WHERE status = 'sent';
  SELECT COUNT(*) INTO v_failed  FROM connection_queue WHERE status = 'failed';
  SELECT COUNT(*) INTO v_pending FROM connection_queue WHERE status = 'pending';

  SELECT jsonb_agg(e ORDER BY (e->>'count')::int DESC) INTO v_top_errors
  FROM (
    SELECT jsonb_build_object('error', error, 'count', COUNT(*)) AS e
    FROM connection_queue
    WHERE status = 'failed' AND error != ''
    GROUP BY error
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ) sub;

  -- NEW: scan health check (last 6 hours)
  SELECT COUNT(*) INTO v_scan_total
  FROM scan_log WHERE created_at > NOW() - INTERVAL '6 hours';

  SELECT COUNT(*) INTO v_scan_empty
  FROM scan_log WHERE created_at > NOW() - INTERVAL '6 hours'
    AND total_contacts = 0;

  v_scan_rate := CASE WHEN v_scan_total > 0 THEN (v_scan_total - v_scan_empty)::numeric / v_scan_total ELSE 1 END;

  -- NEW: connection failure rate (last 6 hours)
  v_fail_rate := CASE
    WHEN v_sent + v_failed > 0 THEN v_failed::numeric / (v_sent + v_failed)
    ELSE 0
  END;

  -- Alert if scan success rate drops below 50% (with minimum 3 scans)
  IF v_scan_total >= 3 AND v_scan_rate < 0.5 THEN
    INSERT INTO monitor_alerts (alert_type, message, details)
    VALUES ('scan_degraded',
      format('Scan success rate dropped to %s%% (%s/%s scans failed in last 6h)',
        round((1 - v_scan_rate) * 100), v_scan_empty, v_scan_total),
      jsonb_build_object('scan_total', v_scan_total, 'scan_empty', v_scan_empty, 'rate', v_scan_rate));
  END IF;

  -- Alert if connection failure rate exceeds 40%
  IF v_sent + v_failed >= 5 AND v_fail_rate > 0.4 THEN
    INSERT INTO monitor_alerts (alert_type, message, details)
    VALUES ('connection_degraded',
      format('Connection failure rate at %s%% (%s failed, %s sent)',
        round(v_fail_rate * 100), v_failed, v_sent),
      jsonb_build_object('failed', v_failed, 'sent', v_sent, 'top_errors', v_top_errors));
  END IF;

  -- Alert if new error type appeared (not in known list)
  INSERT INTO monitor_alerts (alert_type, message, details)
  SELECT 'new_error_type',
    format('New error type appeared: %s (%s occurrences)', error, COUNT(*)),
    jsonb_build_object('error', error, 'count', COUNT(*))
  FROM connection_queue
  WHERE status = 'failed'
    AND created_at > NOW() - INTERVAL '30 minutes'
    AND error NOT IN (
      'already_connected', 'already_pending', 'wrong_profile',
      'weekly_limit_reached', 'no_linkedin_url', 'invalid_linkedin_url',
      'no_profile_urn', 'no_csrf_token', 'no_linkedin_session',
      'no_chrome_window', 'no_response', 'no_vanity_name',
      'send_btn_not_found', 'connect_not_available'
    )
    AND error NOT LIKE 'api_error_%'
    AND error NOT LIKE 'fetch_failed%'
    AND error NOT LIKE 'not_logged_in%'
  GROUP BY error
  HAVING COUNT(*) >= 2;

  INSERT INTO public.queue_monitor_log (resets, sent_count, failed_count, pending_count, top_errors, notes)
  VALUES (v_resets, v_sent, v_failed, v_pending, COALESCE(v_top_errors, '[]'),
    format('scan_rate=%s%% (%s/%s)', round(v_scan_rate * 100), v_scan_total - v_scan_empty, v_scan_total));
END;
$$;
```

**Step 3: Verify**

Run: `SELECT * FROM monitor_alerts ORDER BY created_at DESC LIMIT 5;`
Expected: empty (no alerts yet)

**Step 4: Commit**

```bash
git commit -m "feat: extend queue monitor with scan health checks and alerting"
```

---

### Task 7: Build the ops agent

**Files:**
- Create: `.claude/agents/ihn-ops.md`

**Step 1: Create the agent file**

Write `.claude/agents/ihn-ops.md` with the following content. This agent is invoked when Jenny says something like "connections are failing" or "scans are broken":

```markdown
# IHN Ops Agent

You are the ops agent for the "I Hate Networking" Chrome extension. Your job is fast triage when something breaks.

## Project Location
**Always use v2:** `/Users/jenny/WalktheChat Dropbox/Jenny/I hate networking/I hate networking v2/`

## First Response: Check Health

Run these Supabase queries immediately (project_id: `urgibxjxbcyvprdejplp`):

1. **Recent alerts:**
   ```sql
   SELECT alert_type, message, created_at FROM monitor_alerts ORDER BY created_at DESC LIMIT 5;
   ```

2. **Scan health (last 24h):**
   ```sql
   SELECT
     COUNT(*) AS total_scans,
     COUNT(*) FILTER (WHERE total_contacts = 0) AS empty_scans,
     COUNT(*) FILTER (WHERE NOT button_found) AS button_failures,
     COUNT(*) FILTER (WHERE NOT modal_found AND button_found) AS modal_failures,
     round(AVG(total_contacts)) AS avg_contacts,
     round(AVG(linkedin_count)) AS avg_linkedin
   FROM scan_log WHERE created_at > NOW() - INTERVAL '24 hours';
   ```

3. **Connection health:**
   ```sql
   SELECT error, COUNT(*) FROM connection_queue WHERE status = 'failed' GROUP BY error ORDER BY COUNT(*) DESC LIMIT 10;
   ```

4. **Queue monitor trend:**
   ```sql
   SELECT ran_at, resets, sent_count, failed_count, pending_count, notes
   FROM queue_monitor_log ORDER BY ran_at DESC LIMIT 5;
   ```

## Known Break Patterns

Read `docs/FIXES.md` and the debugging notes in the memory file at `/Users/jenny/.claude/projects/-Users-jenny/memory/linkedin-automation.md` before proposing any fix. These document every past bug and what NOT to reintroduce.

### Luma Breaks (scan failures)

| Symptom | Check | Fix |
|---------|-------|-----|
| `button_found = false` spike | Query `scan_log` for `debug_details->'buttonTexts'` to see what buttons exist | Update `labelPatterns` in `luma.ts:runScan()` (line ~396) with new button text |
| `modal_found = false` | Luma changed modal structure | Update `findModalScrollable()` in `luma.ts` (line ~171) |
| `api_guests = 0` everywhere | Luma changed API endpoint names | Update `GUEST_API_PATTERN` regex in `luma.ts:installGuestApiInterceptor()` (line ~278) |
| `linkedin_count = 0` but `total > 0` | Luma changed `__NEXT_DATA__` structure | Check `extractProfileFromNextData()` in `luma.ts` (line ~211) |

### LinkedIn Breaks (connection failures)

| Symptom | Check | Fix |
|---------|-------|-----|
| `no_profile_urn` spike | LinkedIn changed API or HTML structure | Check `fetchProfileUrnViaApi()` in `linkedin.ts` (line ~69) |
| `api_error_403` or `not_logged_in` | CSRF token issue | Check `getCsrfToken()` and service-worker JSESSIONID reader (service-worker.ts line ~679) |
| `api_error_400` new message | LinkedIn changed invite endpoint | Check `INVITE_URL` in `linkedin.ts` (line ~8) and `parseInviteError()` (line ~115) |
| `weekly_limit_reached` | Normal, not a bug | Tell user to wait |

## Hard Rules (NEVER violate)

1. `findButtonByText` MUST use `includes` as fallback — exact matching breaks on nested spans
2. NEVER use `[class*="upsell"]` in paywall dismiss — it matches the Connect modal itself
3. `already_connected` check MUST come AFTER `openMoreActionsIfNeeded()`
4. Supabase `.update().order().limit(1)` is BROKEN — always select-then-update-by-id
5. `namesMatch()` checks first name only — checking all words breaks for nicknames/abbreviated names
6. NEVER use `g.name` (Luma name) as fallback for guest names — only `g.linkedin_name`
7. NEVER add `chrome.action.onClicked` listener — breaks side panel
8. Always use `state.pending` not bare `pending` in render context
9. Campaign re-launch: both upserts need `ignoreDuplicates: true`
10. Build only compiles: `sidepanel/sidepanel.ts`, `background/service-worker.ts`, `content/luma.ts`, `content/linkedin.ts` — do NOT edit `content/panel.ts`

## After Fixing

1. Run `cd extension && npm run build` — must succeed
2. Update `docs/FIXES.md` with new entry using the template at the bottom of that file
3. Update `/Users/jenny/.claude/projects/-Users-jenny/memory/linkedin-automation.md` if a new pattern was discovered
```

**Step 2: Commit**

```bash
git add .claude/agents/ihn-ops.md
git commit -m "feat: create IHN ops agent for fast triage and monitoring"
```

---

### Task 8: Final build + smoke test

**Step 1: Full build**

Run: `cd extension && npm run build`
Expected: all 4 files compile without errors

**Step 2: Verify scan_log table is accessible**

Run Supabase query: `SELECT COUNT(*) FROM scan_log;`
Expected: `0` (empty, ready for data)

**Step 3: Verify monitor function updated**

Run: `SELECT public.ihn_queue_monitor();`
Then: `SELECT * FROM queue_monitor_log ORDER BY ran_at DESC LIMIT 1;`
Expected: new row with `notes` containing `scan_rate=`

**Step 4: Final commit if any build artifacts changed**

```bash
git add extension/dist/
git commit -m "chore: rebuild dist after monitoring changes"
```
