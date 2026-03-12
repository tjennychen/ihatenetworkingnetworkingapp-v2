# Remote Coding Agent + DOM Monitor — Design Spec
_Date: 2026-03-12 (revised: MCP-based architecture)_

## Goal

Build a personal remote coding agent that lives on a VPS and is accessible via Telegram from anywhere. The IHN nightly DOM monitor is its first use case — automatically detecting when Luma or LinkedIn break the extension, then using Claude Code + browser automation to investigate and fix like a real developer would. The system compounds knowledge over time: every fix improves the test suite and memory files so future sessions start smarter.

---

## What This Is Not

- Not a fully autonomous self-deploying system. Jenny approves every merge.
- Not a product. This is Jenny's personal dev infrastructure.
- Not built from scratch. Orchestrates existing agents + skills + official MCP servers.

---

## Architecture

```
TELEGRAM (phone)
  ← alerts, proposed fixes, Claude responses
  → messages, questions, "ship it"
       |
  VPS (Hetzner CX22, ~$5/mo)
  ┌──────────────────────────────────────────────────┐
  │  telegram-bot   ←→   Claude Code CLI             │
  │                            ↕                     │
  │                   MCP servers:                   │
  │                   - playwright-mcp  (browser)    │
  │                   - supabase-mcp    (database)   │
  │                   - github-mcp      (PRs)        │
  │                            ↕                     │
  │                   repos (git)                    │
  │                                                  │
  │  cron @3am                                       │
  │    └→ health-check.js (lightweight, no Claude)   │
  │         ├→ pass: silent                          │
  │         └→ fail: wake Claude Code                │
  └──────────────────────────────────────────────────┘
       |
  SUPABASE (existing)
  - extension_config (new) — live selectors
  - scan_log (existing) — production telemetry
  - monitor_alerts (existing) — pg_cron anomalies

  UPTIMEROBOT (free)
  - Pings bot health endpoint every 5 min
  - Alerts if VPS goes down
```

---

## Key Design Principle: Two-Tier Monitoring

**Tier 1 — Lightweight health check (runs every night, no AI):**
Simple Playwright script, ~30 lines. Loads a real Luma event, clicks the guest button, counts guests. Loads a LinkedIn profile, checks Connect button. If both pass → exit 0, silent. If either fails → exit 1, wake Claude.

No AI involved until something is actually broken.

**Tier 2 — Claude Code investigation (only on failure):**
Claude Code invoked with all three MCP servers available. Claude navigates the page itself, sees exactly what a real user sees, queries Supabase for corroboration, proposes and applies a fix, opens a GitHub PR. No fixed diagnostic format. No custom test scripts to maintain. Claude investigates interactively.

This is what "Playwright acting as a normal user" means — Claude directs a real logged-in browser session step by step.

---

## Three MCP Servers (Official, Maintained by Their Teams)

### `@playwright/mcp` (Microsoft)
```bash
claude mcp add --transport stdio playwright -- npx -y @playwright/mcp@latest
```
- 70+ tools: `browser_navigate`, `browser_take_screenshot`, `browser_click`, `browser_wait_for`, `browser_evaluate`, tab management, form submission
- **Persistent profile:** `--user-data-dir ~/.cache/ms-playwright/ihn-profile` — log into Luma + LinkedIn once, stays logged in
- Claude uses this to navigate pages and see exactly what a real user sees

### `supabase-mcp` (Supabase official)
```bash
claude mcp add --transport http supabase https://mcp.supabase.com/mcp
```
- SQL execution, table queries, migration management, logs
- Claude queries `scan_log`, `monitor_alerts`, reads/updates `extension_config` directly
- No need for Claude to write custom Supabase client code

### `github-mcp-server` (GitHub official)
```bash
claude mcp add --transport http github https://api.githubcopilot.com/mcp/
```
- PR creation, branch management, issue tracking
- "ship it" → Claude calls `create_pull_request` tool → bot sends Jenny the PR link

---

## Four Components

### 1. Health Check Trigger (`monitor/health-check.js`)

Lightweight Playwright script. Runs at 3am. No Claude involved.

```javascript
// Pseudocode
const browser = await chromium.launchPersistentContext(profileDir)

// Luma check
await page.goto(config.luma_test_url)
click guest button matching config.luma_button_labels
wait 3s
assert guest links > 0  // exit 1 if fails

// LinkedIn check
await page.goto(config.linkedin_test_url)
assert Connect or More button exists  // exit 1 if fails
check JSESSIONID cookie readable     // separate alert: "re-login needed"

exit 0  // all good, silent
```

On exit 1: calls `monitor/wake-claude.js` which invokes Claude Code with the failure context.

### 2. Claude Code + MCP Investigation

When health check fails, Claude Code is invoked:

```bash
claude -p "
The nightly IHN health check failed. Here is what the lightweight check reported: [failure details].

You have access to:
- playwright-mcp: navigate the real Luma/LinkedIn page and see what's there
- supabase-mcp: query scan_log and monitor_alerts for corroboration
- github-mcp: create a PR branch when ready

Please investigate, propose a fix, and send a summary to Telegram.
Consult .claude/agents/ihn-ops.md for known break patterns before starting.
"
```

Claude then acts like a developer debugging the issue:
1. Navigates to the failing Luma event URL via playwright-mcp
2. Takes a screenshot, observes what buttons exist
3. Queries `scan_log` via supabase-mcp for recent failures
4. Identifies root cause using ihn-ops break pattern table
5. Edits the code (or updates `extension_config` for label-only fixes)
6. Runs `npm run build`
7. Creates PR via github-mcp
8. Sends summary to Telegram

### 3. ihn-ops Agent (existing — extended, not rebuilt)

Lives at `.claude/agents/ihn-ops.md`. Extended with:

**VPS path context:**
```
If running on VPS (no /Users/jenny path):
  Repo root: ~/repos/ihn-v2/
  Memory: ~/repos/ihn-v2/.claude/memory/
  Build: cd ~/repos/ihn-v2/extension && npm run build (use .nvmrc)
```

**MCP tool guidance added to agent:**
- Use `browser_navigate` + `browser_take_screenshot` to see the actual current Luma/LinkedIn DOM before proposing fixes
- Use `supabase-mcp` for all DB queries (no need to write custom clients)
- Use `github-mcp` `create_pull_request` for "ship it"

**After-fix checklist (updated):**
1. Run `npm run build`
2. Append to `docs/FIXES.md`
3. Append to `.claude/memory/linkedin-automation.md`
4. Draft regression test → save to `monitor/staging/` (not auto-activated)
5. Create PR via github-mcp → send link to Telegram

New tests go to `monitor/staging/` first. Jenny moves to `monitor/` to activate.

### 4. Telegram Bot (`bot/index.js`)

Node.js + pm2. Two modes:

**Alert mode** (health check fail):
- Sends: what broke, Claude's diagnosis, proposed fix summary, GitHub PR link
- Jenny replies to ask questions → routed back to Claude Code with thread context
- "ship it" → PR already created by Claude, Jenny just merges on GitHub

**Conversation mode** (Jenny-triggered):
- Any message → `claude -p "[message + thread context]"` with all MCP servers available
- Claude can investigate anything: check Supabase, browse a page, read code, make changes
- Same "ship it" → PR flow

**Commands:** `/status`, `/health`, `/logs`

**Security:** Bot token + Supabase key in `/etc/ihn-agent/.env`. Session threads in `bot/sessions/` (mode 700, cleared after 24h).

---

## Remote Config (`extension_config` Supabase table)

```sql
CREATE TABLE extension_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO extension_config VALUES
  ('luma_button_labels',       '["Guests","Going","Attendees","See all","Went","Registered"]'),
  ('luma_api_pattern',         '"(guest|guests|ticket|tickets|attendee|attendees|rsvp|participant|participants)"'),
  ('luma_next_data_path',      '"props.pageProps.initialData.user"'),
  ('monitor_test_luma_url',    '"https://luma.com/<fill-before-first-run>"'),
  ('monitor_test_linkedin_url','"https://www.linkedin.com/in/<fill-before-first-run>"');
```

Extension fetches via service worker (existing authed Supabase client) → cached 1h in `chrome.storage.local` → content script reads via `chrome.runtime.sendMessage({ type: 'GET_CONFIG' })`. Compiled constants remain as fallback.

**Who updates it:**
- Health check detects label-only break → Claude updates `luma_button_labels` directly (no code change, no PR, no Jenny)
- Claude proposes config fix → after Jenny approves
- Jenny edits directly in Supabase dashboard

**Credentials:** Supabase service key in `/etc/ihn-agent/.env`. Service key scope is intentional (monitor needs write access to `extension_config`). Rotate immediately if VPS is compromised.

---

## Organic Improvement Loop

```
Health check fails at 3am
  → Claude Code + MCP investigates (navigates real page, queries DB)
    → ihn-ops break pattern table identifies cause
      → Claude fixes code or updates extension_config
        → After-fix checklist:
            1. Update linkedin-automation.md memory file
            2. Update FIXES.md regression guard
            3. Draft Playwright test → monitor/staging/ (Jenny activates)
        → github-mcp creates PR → Telegram alert
          → Jenny merges
            → Next Claude session inherits fix history via memory files
```

Every real-world failure that reaches the monitor generates a draft test. Test suite grows only on Jenny's approval. Knowledge compounds via git.

---

## Existing Assets — Reused

| Asset | Role |
|---|---|
| `.claude/agents/ihn-ops.md` | Diagnostic brain — extended with MCP tool guidance + VPS paths |
| `.claude/skills/linkedin-dom-automation` | Fix reference — Claude invokes when fixing LinkedIn selectors |
| `memory/linkedin-automation.md` | Living knowledge base — updated after every fix, syncs via git |
| `memory/system-prompt-design-patterns.md` | Used to write VPS agent system prompts |
| Supabase `scan_log` + `monitor_alerts` | Production telemetry — Claude queries these during investigation |
| pg_cron `ihn_queue_monitor()` | Extended to detect new error types + session expiry |

---

## VPS Setup (Hetzner CX22, ~$5/mo)

**One-time manual setup:**
1. Ubuntu 22.04, Node.js (`.nvmrc` version), npm, pm2
2. Claude Code CLI — authenticated with Jenny's account
3. Register MCP servers (playwright, supabase, github)
4. `npx playwright install chromium`
5. Launch headed browser once, log into Luma + LinkedIn → persistent profile saved
6. Clone IHN v2 to `~/repos/ihn-v2/`
7. Create `/etc/ihn-agent/.env` (bot token + Supabase service key)
8. `pm2 start bot/index.js --name ihn-bot`
9. Cron jobs configured
10. **Take Hetzner snapshot**

**Cron:**
```
0 3 * * *   node ~/repos/ihn-v2/monitor/health-check.js
0 * * * *   node ~/repos/ihn-v2/monitor/poll-alerts.js
```

**LinkedIn session maintenance:** Sessions expire every 30-90 days. `linkedin_session_expired` Telegram alert = SSH in, re-login via headed browser. Requires human (2FA).

**VPS uptime:** UptimeRobot free tier pings `/health` every 5 min.

---

## Approval Workflow

1. 3am: health check fails → Claude investigates with MCP → proposes fix
2. Morning: Jenny sees Telegram message with diagnosis + PR link
3. Jenny asks questions in Telegram if needed → Claude responds with MCP access
4. Jenny merges PR on GitHub from phone
5. Chrome Store submission remains manual

---

## Implementation Order

1. **Merge `feature/voyager-api` branch first** — eliminates ~15 of 21 LinkedIn DOM bug patterns before any monitoring is built
2. Build `extension_config` remote config + update `luma.ts` to fetch it
3. Set up VPS + register MCP servers + login to Luma/LinkedIn
4. Build lightweight `health-check.js` trigger
5. Update `ihn-ops.md` with VPS paths + MCP guidance + after-fix checklist
6. Build Telegram bot
7. Write initial regression tests for known patterns (the 21 in `linkedin-automation.md`) → `monitor/staging/`
8. Jenny reviews + activates tests

---

## Out of Scope

- Auto-publishing to Chrome Store
- Auto-merging without Jenny's approval
- Monitoring other projects (IHN first, system designed to extend)
- Luma public API (requires organizer credentials)
- Sentry (redundant with existing Supabase telemetry)
- Claude API / Anthropic SDK (MCP approach uses Claude Code subscription only)
