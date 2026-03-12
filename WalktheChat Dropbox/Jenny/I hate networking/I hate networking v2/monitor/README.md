# IHN Monitor Scripts

Nightly DOM health checker + alert poller for the I Hate Networking Chrome extension.
Lives at `monitor/`. Runs on VPS via cron. No build step — plain Node.js.

## Scripts

**`health-check.js`** — Runs at 3am. Loads a real Luma event page and a LinkedIn profile via Playwright (persistent logged-in browser profile). Checks that guest links appear after clicking the guest button, and that LinkedIn profile buttons are visible. Silent on pass. On failure: sends a Telegram alert and invokes `wake-claude.js`. LinkedIn session expiry sends a separate "re-login" message and exits 0 (not a code bug).

**`wake-claude.js`** — Called by `health-check.js` on DOM failure. Builds a prompt with failure details and runs `claude -p "..."` with playwright-mcp, supabase-mcp, and github-mcp available. Sends the resulting diagnosis to Telegram.

**`poll-alerts.js`** — Runs hourly. Queries `monitor_alerts` in Supabase for rows newer than the last-checked timestamp (stored in `monitor/.last-poll`). Formats and sends each new alert to Telegram.

## Manual test run

```bash
MONITOR_LUMA_URL="https://lu.ma/your-event" \
MONITOR_LINKEDIN_URL="https://www.linkedin.com/in/some-person" \
node monitor/health-check.js
```

## Configuring test URLs

Set `monitor_test_luma_url` and `monitor_test_linkedin_url` in the Supabase `extension_config` table. Use a stable public Luma event (not one that expires). Use any public LinkedIn profile. Claude can update `luma_button_labels` there directly when labels change — no code change or PR needed.

## Two-tier design

Tier 1 (`health-check.js`): lightweight, no AI, no cost. Runs every night.
Tier 2 (`wake-claude.js`): Claude Code + MCP investigation. Only runs when Tier 1 finds a real failure.
