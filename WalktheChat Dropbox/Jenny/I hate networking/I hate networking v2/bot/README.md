# IHN Telegram Bot

Node.js bot (pm2-managed) that bridges Telegram to Claude Code on the VPS.

## Setup

### 1. Get a bot token

1. Open Telegram, message `@BotFather`
2. `/newbot` → follow prompts → copy the token
3. Start a conversation with your new bot, then get your chat ID:
   `https://api.telegram.org/bot<TOKEN>/getUpdates` — `result[0].message.chat.id`

### 2. Environment variables

Add to `/etc/ihn-agent/.env`:

```
TELEGRAM_BOT_TOKEN=<token from BotFather>
TELEGRAM_CHAT_ID=<your numeric chat ID>
SUPABASE_URL=https://<project-id>.supabase.co
SUPABASE_SERVICE_KEY=<service role key>
```

### 3. Install and start

```bash
cd ~/repos/ihn-v2/bot
npm install
pm2 start index.js --name ihn-bot
pm2 save
```

### 4. Verify

```bash
pm2 logs ihn-bot
curl http://127.0.0.1:3456/health
```

## Commands

| Command   | What it does |
|-----------|--------------|
| `/status` | Last poll timestamp + last health check result |
| `/health` | Scan log summary for the last 24h |
| `/logs`   | connection_queue error breakdown (last 7 days) |
| `/clear`  | Clear the current conversation thread |
| any text  | Routes to Claude Code with MCP access |

## HTTP endpoints (internal, 127.0.0.1 only)

| Endpoint     | Used by |
|--------------|---------|
| `POST /send` | `monitor/wake-claude.js`, `monitor/poll-alerts.js` |
| `GET /health` | UptimeRobot uptime check |

## UptimeRobot

Point UptimeRobot at `http://<vps-ip>:3456/health` every 5 min for uptime alerts.
You'll need to open port 3456 in the VPS firewall for this, or use a reverse proxy.
