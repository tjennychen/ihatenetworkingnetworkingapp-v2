# Remote Coding Agent + DOM Monitor — Design Spec
_Date: 2026-03-12_

## Goal

Build a personal remote coding agent that lives on a VPS and is accessible via Telegram from anywhere. The IHN nightly DOM monitor is its first use case — automatically detecting when Luma or LinkedIn break the extension, generating a code fix, and routing it to Jenny for one-tap approval. The system is designed to compound knowledge over time: every fix improves the test suite and the memory files so future Claude sessions start smarter.

---

## What This Is Not

- Not a fully autonomous self-deploying system. Jenny approves every merge.
- Not a product. This is Jenny's personal dev infrastructure.
- Not built from scratch. It orchestrates existing agents + skills, does not replace them.

---

## Architecture

```
TELEGRAM (phone)
  ← alerts, diffs, proposed fixes, Claude responses
  → messages, questions, "ship it"
       |
  VPS (Hetzner CX22, ~$5/mo)
  ┌────────────────────────────────────────┐
  │ telegram-bot   ←→   Claude Code CLI   │
  │                          ↕            │
  │                    repos (git)        │
  │                                       │
  │ cron @3am                             │
  │   └→ Playwright monitor               │
  │         ├→ luma.test.ts               │
  │         └→ linkedin.test.ts           │
  │              ↕                        │
  │         Luma + LinkedIn               │
  │         (persistent Chrome profile)   │
  └────────────────────────────────────────┘
       |
  SUPABASE (existing)
  - extension_config (new) — live selectors
  - scan_log (existing) — production telemetry
  - monitor_alerts (existing) — pg_cron anomalies

  UPTIMEROBOT (free)
  - Pings VPS every 5 min
  - Alerts via Telegram if VPS/bot goes down
```

---

## Five Components

### 1. Playwright Monitor (`monitor/` on VPS)

Two test suites run nightly. Each returns a structured JSON diagnostic.

**`luma.test.ts`**
- Loads a real Luma event URL (stored in `extension_config.monitor_test_luma_url`)
- Clicks guest button using labels from `extension_config.luma_button_labels`
- Waits for API interception (3s + scroll)
- Asserts: `apiGuestsCount > 0`
- On failure captures: all button texts on page, API URLs fired, modal presence, DOM snapshot of guest section, `__NEXT_DATA__` path validity

**`linkedin.test.ts`**
- Loads a real LinkedIn profile URL (stored in `extension_config.monitor_test_linkedin_url`)
- Checks Connect button exists (or More/Resources → Connect)
- Checks JSESSIONID cookie readable via `chrome.cookies`
- Checks Voyager API endpoint reachable (HEAD with CSRF token)
- On failure captures: buttons found, cookie state, API response code
- **Session expiry detection:** If response is 401/403 or page redirects to login, emits `linkedin_session_expired` (not a DOM break alert — sends a separate "re-login needed" Telegram message)

On any test failure:
1. Formats diagnostic as structured JSON
2. Invokes `ihn-ops` agent via `claude -p "<prompt with diagnostic payload>"` on VPS
3. `ihn-ops` queries Supabase for corroboration, proposes fix
4. Sends proposed fix + explanation to Telegram

**Auto-config update (label-only breaks):** If `luma.test.ts` fails only because no button label matched, but a button exists whose text matches a known pattern (e.g. "Registered", "Going (12)"), the monitor updates `extension_config.luma_button_labels` directly in Supabase — no code change, no ihn-ops invocation, no Jenny involvement. Extension picks it up on next scan.

### 2. ihn-ops Agent (existing — extended, not rebuilt)

Lives at `.claude/agents/ihn-ops.md`. Currently invoked manually. Extended with:

**VPS path context block** (added to top of agent file):
```
If running on VPS (detected by absence of /Users/jenny path):
  - Repo root: ~/repos/ihn-v2/
  - Memory files: ~/repos/ihn-v2/.claude/memory/ (synced from main branch)
  - Build command: cd ~/repos/ihn-v2/extension && npm run build
  - Node version: use .nvmrc in repo root
```

**Monitor payload detection:** Agent checks if the invocation prompt contains `"diagnostic_payload":`. If yes: skip health check queries, go directly to break pattern lookup with the diagnostic data. If no: run full health check as normal.

**After-fix checklist on VPS:**
1. Run `npm run build` using repo-local Node (`.nvmrc`)
2. Append to `docs/FIXES.md`
3. Append to `.claude/memory/linkedin-automation.md` (committed to repo, syncs to Mac on pull)
4. Draft new Playwright test case for this failure mode — saved to `monitor/staging/` (not yet in nightly suite)

New tests go into `monitor/staging/` first. Jenny reviews + moves to `monitor/` to activate. Prevents a bad auto-generated test from false-alarming every night.

### 3. Telegram Bot (`bot/` on VPS)

Node.js process managed by `pm2`. Two modes:

**Alert mode** (monitor-triggered):
- Formats ihn-ops diagnosis + proposed fix
- Sends to Jenny with diff preview
- Jenny replies to ask questions → bot stores thread in `sessions/<chat_id>.json`, routes to Claude Code with full thread context
- "ship it" → Claude applies fix, builds, pushes PR branch → bot sends GitHub diff link

**Conversation mode** (Jenny-triggered from anywhere):
- Any message → routed to `claude -p` with: message + thread context + recent scan_log summary
- Full back-and-forth until done
- Same "ship it" → PR branch flow

**Commands:**
- `/status` — last monitor run result + timestamp
- `/health` — Supabase scan_log summary (last 24h)
- `/logs` — recent failed connections breakdown

**Security:** Bot token and Supabase service key stored in `/etc/ihn-agent/.env` (not in repo). `.gitignore` blocks all `.env` files. Session thread files stored in `bot/sessions/` with directory mode `700`, owned by the bot process user. Cleared after "ship it" or 24h inactivity — these files contain code diffs and diagnostic details and should not persist longer than needed.

**Thread format (`sessions/<chat_id>.json`):**
```json
{
  "thread_id": "...",
  "started_at": "...",
  "context": "monitor_alert | conversation",
  "messages": [
    { "role": "user", "content": "..." },
    { "role": "assistant", "content": "..." }
  ]
}
```
Passed as `--system` context on each `claude -p` invocation.

### 4. Remote Config (`extension_config` table in Supabase)

```sql
CREATE TABLE extension_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO extension_config VALUES
  ('luma_button_labels',    '["Guests","Going","Attendees","See all","Went","and N others","Registered"]'),
  ('luma_api_pattern',      '"(guest|guests|ticket|tickets|attendee|attendees|rsvp|participant|participants)"'),
  ('luma_next_data_path',   '"props.pageProps.initialData.user"'),
  ('monitor_test_luma_url', '"https://luma.com/<test-event-slug>"'),
  ('monitor_test_linkedin_url', '"https://www.linkedin.com/in/<test-profile-slug>"');
```

**How extension consumes it:** `service-worker.ts` fetches the config table on startup (using existing authed Supabase client). Stores result in `chrome.storage.local` with a 1-hour TTL. Content script (`luma.ts`) reads from `chrome.storage.local` via `chrome.runtime.sendMessage({ type: 'GET_CONFIG' })`. Compiled-in constants remain as fallback if fetch fails or storage is empty.

This keeps all Supabase auth in the service worker (existing pattern) and avoids CORS issues in the content script.

**Who can update it:**
- Monitor auto-updates `luma_button_labels` for label-only breaks (no human)
- ihn-ops agent updates any field when Claude proposes a config fix (after Jenny approves)
- Jenny can edit directly in Supabase dashboard

**Supabase credentials on VPS:** Monitor (`poll.js`, `run.js`) uses the service key from `/etc/ihn-agent/.env`. The service key bypasses RLS — this is intentional (monitor needs to write `extension_config` directly). If the VPS is ever compromised, rotate the service key immediately. A future improvement would be a dedicated monitor role with write access scoped to `extension_config` only.

**Test URLs:** `monitor_test_luma_url` and `monitor_test_linkedin_url` must be populated with real values before the first monitor run. Use a public Luma event (past or upcoming, with visible guests) and any public LinkedIn profile. Document the chosen URLs in the VPS setup notes after initial configuration.

### 5. Error Monitoring (Supabase-native, no Sentry)

Sentry dropped — Sentry does not natively write to Supabase, adding an edge function webhook just to bridge them adds complexity for no gain. The existing `scan_log` + `monitor_alerts` + `connection_queue` tables already capture the data Sentry would provide for this extension.

**Instead:** Extend the existing pg_cron `ihn_queue_monitor()` to also detect:
- New unknown error strings appearing in `connection_queue.error` (2+ in 30min) → `monitor_alerts`
- Scan success rate drop → already monitored
- `linkedin_session_expired` events from the VPS monitor → `monitor_alerts`

VPS hourly poll of `monitor_alerts` picks these up and routes to Telegram. Same loop as DOM breaks.

---

## Organic Improvement Loop

```
Monitor detects break (or pg_cron spots anomaly in scan_log)
  → ihn-ops diagnoses + proposes fix
    → Jenny approves → merged to main
      → ihn-ops after-fix checklist:
          1. Appends to .claude/memory/linkedin-automation.md
          2. Appends to docs/FIXES.md
          3. Drafts new Playwright test → saved to monitor/staging/
             (Jenny reviews + activates — not auto-added to nightly suite)
  → Next Claude session on any machine inherits the fix history
```

Knowledge compounds. Test suite grows only on Jenny's approval. Memory files sync via git pull.

---

## Existing Assets — Reused, Not Replaced

| Asset | Role |
|---|---|
| `.claude/agents/ihn-ops.md` | Diagnostic brain. Extended with VPS path context + monitor payload detection |
| `.claude/skills/linkedin-dom-automation` | Fix guide. Claude invokes it when generating LinkedIn selector fixes |
| `memory/linkedin-automation.md` | Living knowledge base. Committed to repo, syncs to VPS via git |
| `memory/system-prompt-design-patterns.md` | Blueprint used to write VPS agent system prompts |
| Supabase `scan_log` + `monitor_alerts` | Production telemetry — monitor corroborates against these |
| pg_cron `ihn_queue_monitor()` | Extended to detect new error types + session expiry events |

---

## VPS Infrastructure

**Provider:** Hetzner CX22 (~$5/mo). 4GB RAM, 2 vCPU, 40GB SSD, Ubuntu 22.04.

**One-time setup (manual):**
1. Ubuntu 22.04, Node.js (version from `.nvmrc`), npm
2. Claude Code CLI — authenticated with Jenny's account
3. Playwright + Chromium (`npx playwright install chromium`)
4. Persistent Chrome profile directory — log into Luma + LinkedIn once via headed browser
5. Clone IHN v2 repo to `~/repos/ihn-v2/`
6. Create `/etc/ihn-agent/.env` with Telegram bot token + Supabase service key
7. `pm2 start bot/index.js --name ihn-bot`
8. Configure cron jobs
9. **Take Hetzner snapshot** — restore point

**Cron:**
```
0 3 * * *   node ~/repos/ihn-v2/monitor/run.js    # nightly test suite
0 * * * *   node ~/repos/ihn-v2/monitor/poll.js   # poll monitor_alerts
```

**LinkedIn session maintenance:** Sessions typically last 30-90 days. When `linkedin_session_expired` fires in Telegram, Jenny SSHs in once and re-logs via headed browser. No automation — LinkedIn 2FA requires human intervention.

**VPS uptime monitoring:** UptimeRobot free tier pings the Telegram bot's health endpoint (`GET /health`) every 5 minutes. Alerts Jenny via separate Telegram notification if the VPS/bot goes unreachable. Closes the gap where a dead VPS produces no alerts at all.

---

## Approval Workflow

1. 3am: monitor finds break → ihn-ops proposes fix → Telegram alert
2. Morning: Jenny sees message, asks questions or "ship it"
3. Claude Code on VPS applies fix, runs `npm run build` (Node from `.nvmrc`)
4. Pushes to new branch `fix/<slug>-<date>`
5. Bot sends GitHub PR link
6. Jenny reviews diff, merges from GitHub on phone
7. Chrome Store submission remains manual

---

## Out of Scope

- Auto-publishing to Chrome Store
- Auto-merging without Jenny's approval
- Monitoring other projects (IHN is first; system designed to extend)
- Luma public API (requires organizer credentials)
- Sentry (redundant with existing Supabase telemetry for this use case)
