# VPS Setup Manual — IHN Remote Coding Agent

This is the human companion guide to `vps-setup.sh`. The script handles most of the automated parts. This doc covers the decisions, the manual steps, and where to find each credential.

---

## 1. Getting a Hetzner CX22

1. Sign up at [hetzner.com](https://www.hetzner.com) (Cloud, not dedicated)
2. Create a new project
3. Click "Add Server":
   - Location: pick the one closest to you (Ashburn or Nuremberg are fine)
   - Image: **Ubuntu 22.04**
   - Type: **CX22** (~$5/mo, 2 vCPU, 4 GB RAM — plenty for the bot + Playwright)
   - SSH keys: add your public key here (strongly recommended over password login)
   - No additional volumes needed
4. Click "Create & Buy Now"
5. Note the server's public IPv4 address from the Hetzner dashboard

---

## 2. SSH In

```bash
ssh root@<your-vps-ip>
```

If you added an SSH key during setup, this just works. If not, the root password is in the Hetzner dashboard under the server's "Rescue" tab.

---

## 3. Run the Setup Script

Download and run from the server:

```bash
curl -o vps-setup.sh https://raw.githubusercontent.com/tjennychen/ihn-v2/main/scripts/vps-setup.sh
bash vps-setup.sh
```

Or if you've already cloned the repo locally, scp it over:

```bash
scp scripts/vps-setup.sh root@<vps-ip>:~/
ssh root@<vps-ip> bash vps-setup.sh
```

The script prints `=== Step N: ... ===` headers as it goes. Total runtime is about 5-10 minutes (Playwright Chromium download is the slow part).

---

## 4. Fill in `.env`

After the script finishes, fill in the values it left as placeholders:

```bash
nano /etc/ihn-agent/.env
```

Here's what each one is and where to find it:

### `TELEGRAM_BOT_TOKEN`

This is your bot's API token from Telegram.

1. Open Telegram, search for `@BotFather`
2. Send `/newbot`
3. Pick a name (e.g. "IHN Agent") and a username (e.g. `ihn_agent_bot` — must end in `bot`)
4. BotFather replies with a token like `7123456789:AAHk...`
5. Copy that full string into the `.env`

### `TELEGRAM_CHAT_ID`

Your numeric Telegram user ID (so the bot only talks to you).

1. Send any message to your new bot in Telegram
2. In a browser, go to: `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates`
3. Find `result[0].message.chat.id` in the JSON — it's a number like `123456789`
4. That's your chat ID

### `SUPABASE_URL`

1. Open your Supabase project dashboard
2. Go to Settings → API
3. Copy the "Project URL" (looks like `https://abcdefgh.supabase.co`)

### `SUPABASE_SERVICE_KEY`

1. Same page: Settings → API
2. Under "Project API keys", find the **service_role** key (not the anon key)
3. Click "Reveal" and copy it
4. Keep this secret — it bypasses row-level security. The bot needs it to write to `extension_config` and read `monitor_alerts`.
5. Rotate it immediately if the VPS is ever compromised (Supabase dashboard → Settings → API → Rotate key)

### `MONITOR_LUMA_URL`

A public Luma event page the health check will load every night to verify guest scraping works. Requirements:
- Must be public (no login needed to view guests)
- Must have at least a few guests listed
- Should be stable — use a past event that won't disappear, not a future one that might get cancelled

You can leave this blank and set it in the Supabase `extension_config` table instead (preferred — easier to update without SSH).

### `MONITOR_LINKEDIN_URL`

Any public LinkedIn profile the health check will load to verify the Connect/More button is visible. Your own profile works fine:

```
https://www.linkedin.com/in/tingyi-jenny-chen/
```

Same note: you can leave this blank and set it in Supabase instead.

---

## 5. Authenticate Claude Code

This is a one-time interactive step. The VPS session needs to be tied to your Anthropic account so `claude -p "..."` calls work.

```bash
su - ihn
claude
```

Follow the prompts. It'll open a login URL — open it in your browser, authenticate, and the CLI will save the credentials locally. After that, `claude` works non-interactively for the monitor scripts.

---

## 6. Log into Luma and LinkedIn on the VPS

The Playwright health check and the Claude Code investigation both use a **persistent browser profile** at `~/.cache/ms-playwright/ihn-profile`. You need to log into Luma and LinkedIn in that profile once — after that, the session is saved and reused.

The easiest approach is X forwarding over SSH:

```bash
# On your local machine (Mac):
ssh -X ihn@<vps-ip>

# On the VPS, as ihn:
npx playwright open \
  --user-data-dir ~/.cache/ms-playwright/ihn-profile \
  https://lu.ma
```

This opens a Chromium window on your local screen (via X forwarding). Log into Luma, then navigate to `https://www.linkedin.com` and log in there too. Close the browser when done — the session is saved.

If X forwarding doesn't work, an alternative is to use a VNC server on the VPS (e.g. `tightvncserver`) or Hetzner's web console. The key thing is that the session gets saved to `~/.cache/ms-playwright/ihn-profile` while logged in.

**LinkedIn sessions expire every 30-90 days.** When that happens, you'll get a Telegram alert saying `linkedin_session_expired`. SSH back in and repeat the LinkedIn login step above.

---

## 7. Fill in Supabase `extension_config`

The monitor scripts read test URLs from the `extension_config` table so you can change them without touching code.

1. Go to your Supabase project dashboard
2. Table Editor → `extension_config`
3. Find the row with `key = 'monitor_test_luma_url'` and set its `value` to a JSON string:
   ```json
   "https://lu.ma/your-stable-event-slug"
   ```
4. Find the row with `key = 'monitor_test_linkedin_url'` and set its `value`:
   ```json
   "https://www.linkedin.com/in/tingyi-jenny-chen/"
   ```

The value column is JSONB — include the quotes inside the JSON.

---

## 8. UptimeRobot Setup

UptimeRobot pings the bot's `/health` endpoint every 5 minutes and alerts you if it goes down.

1. Sign up at [uptimerobot.com](https://uptimerobot.com) (free tier works)
2. Click "Add New Monitor":
   - Monitor type: **HTTP(s)**
   - Friendly name: `IHN Bot`
   - URL: `http://<VPS-IP>:3456/health`
   - Monitoring interval: **5 minutes**
3. Set up a Telegram alert channel:
   - My Settings → Alert Contacts → Add Alert Contact → Telegram
   - Follow the Telegram bot auth flow UptimeRobot provides
4. Save

You'll need port 3456 open on the VPS firewall for UptimeRobot to reach it. In Hetzner, go to your server → Firewalls → add an inbound rule for TCP port 3456. If you want to restrict it to UptimeRobot's IP ranges, their IP list is at https://uptimerobot.com/help/locations/

---

## 9. Test the Setup

Run a manual health check to verify everything is wired up:

```bash
su - ihn
node ~/repos/ihn-v2/monitor/health-check.js
```

Expected outputs:
- **Pass:** no output, exits 0. Check `echo $?` to confirm.
- **Luma failure:** prints something like `[health-check] FAIL: luma guest count 0` and sends a Telegram alert
- **LinkedIn session expired:** prints `[health-check] LinkedIn session expired` and sends a separate Telegram alert (not a code failure)
- **LinkedIn failure:** prints failure details and wakes Claude Code

Also verify the bot is running:

```bash
pm2 logs ihn-bot --lines 20
curl http://127.0.0.1:3456/health
```

And send your bot a message in Telegram — it should respond (once `.env` is filled in and pm2 is restarted).

```bash
pm2 restart ihn-bot
```

---

## 10. Take a Hetzner Snapshot

Once everything is working, take a snapshot from the Hetzner dashboard. This is your restore point if something goes wrong.

Hetzner dashboard → your server → Snapshots → Take snapshot. Name it something like `ihn-agent-baseline-YYYY-MM-DD`.

---

## Ongoing Maintenance

| Event | Action |
|---|---|
| LinkedIn session expires (every 30-90 days) | SSH in, re-run the `playwright open` login step |
| Bot goes offline (UptimeRobot alert) | SSH in, `pm2 restart ihn-bot`, check `pm2 logs ihn-bot` |
| VPS reboots | pm2 startup is configured — bot should auto-start. Check with `pm2 list`. |
| Supabase service key rotation | Update `/etc/ihn-agent/.env`, `pm2 restart ihn-bot` |
| Health check false positives | Update `monitor_test_luma_url` in Supabase to a different stable event |
