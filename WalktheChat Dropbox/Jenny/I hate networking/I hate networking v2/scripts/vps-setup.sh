#!/usr/bin/env bash
# vps-setup.sh — One-time setup for the IHN remote coding agent VPS
# Target: fresh Ubuntu 22.04 on Hetzner CX22, running as root initially.
# Run: bash vps-setup.sh
# Idempotent: most steps check before acting.

set -e

NODE_VERSION="22"
IHN_USER="ihn"
REPO_URL="https://github.com/tjennychen/ihn-v2.git"   # TODO: replace with real repo URL if different
REPO_DIR="/home/${IHN_USER}/repos/ihn-v2"
ENV_DIR="/etc/ihn-agent"
ENV_FILE="${ENV_DIR}/.env"
LOGS_DIR="/home/${IHN_USER}/logs"

# ============================================================
echo "=== Step 1: Create non-root user '${IHN_USER}' with sudo ==="
# ============================================================
if id "${IHN_USER}" &>/dev/null; then
  echo "  User '${IHN_USER}' already exists — skipping."
else
  adduser --disabled-password --gecos "" "${IHN_USER}"
  usermod -aG sudo "${IHN_USER}"
  echo "  Created user '${IHN_USER}' and added to sudo group."
fi

# ============================================================
echo "=== Step 2: Install Node.js ${NODE_VERSION} via nvm ==="
# ============================================================
if sudo -u "${IHN_USER}" bash -c "source ~/.nvm/nvm.sh 2>/dev/null && nvm list | grep -q 'v${NODE_VERSION}'"; then
  echo "  Node ${NODE_VERSION} already installed via nvm — skipping."
else
  # Install nvm if not present
  if [ ! -d "/home/${IHN_USER}/.nvm" ]; then
    sudo -u "${IHN_USER}" bash -c \
      "curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  fi

  # Install the target Node version
  sudo -u "${IHN_USER}" bash -c \
    "source ~/.nvm/nvm.sh && nvm install ${NODE_VERSION} && nvm alias default ${NODE_VERSION}"

  # Ensure nvm is loaded in future non-interactive shells
  sudo -u "${IHN_USER}" bash -c "cat >> ~/.bashrc << 'NVMEOF'

# nvm (added by vps-setup.sh)
export NVM_DIR=\"\$HOME/.nvm\"
[ -s \"\$NVM_DIR/nvm.sh\" ] && . \"\$NVM_DIR/nvm.sh\"
NVMEOF"
  echo "  Node ${NODE_VERSION} installed."
fi

# Helper: run a command as ihn with nvm loaded
run_as_ihn() {
  sudo -u "${IHN_USER}" bash -c "source ~/.nvm/nvm.sh && $*"
}

# ============================================================
echo "=== Step 3: Install pm2 globally ==="
# ============================================================
if run_as_ihn "which pm2" &>/dev/null; then
  echo "  pm2 already installed — skipping."
else
  run_as_ihn "npm install -g pm2"
  echo "  pm2 installed."
fi

# ============================================================
echo "=== Step 4: Install Playwright system dependencies ==="
# ============================================================
# Install system packages needed by Playwright's Chromium
apt-get update -qq
run_as_ihn "npx playwright install-deps chromium" || true
echo "  Playwright system deps installed."

# ============================================================
echo "=== Step 5: Install Claude Code CLI ==="
# ============================================================
if run_as_ihn "which claude" &>/dev/null; then
  echo "  Claude Code CLI already installed — skipping."
else
  run_as_ihn "npm install -g @anthropic-ai/claude-code"
  echo "  Claude Code CLI installed."
fi

# ============================================================
echo "=== Step 6: Create /etc/ihn-agent/ directory ==="
# ============================================================
if [ -d "${ENV_DIR}" ]; then
  echo "  ${ENV_DIR} already exists — skipping mkdir."
else
  mkdir -p "${ENV_DIR}"
  chown "${IHN_USER}:${IHN_USER}" "${ENV_DIR}"
  chmod 700 "${ENV_DIR}"
  echo "  Created ${ENV_DIR} (mode 700, owned by ${IHN_USER})."
fi

# ============================================================
echo "=== Step 7: Create .env template ==="
# ============================================================
if [ -f "${ENV_FILE}" ]; then
  echo "  ${ENV_FILE} already exists — skipping. Edit it manually if needed."
else
  cat > "${ENV_FILE}" << 'ENVEOF'
# /etc/ihn-agent/.env
# Loaded by bot/index.js and monitor scripts.
# DO NOT commit this file. Mode 700 on this directory.

# Telegram bot token — from @BotFather on Telegram
TELEGRAM_BOT_TOKEN=REPLACE_WITH_BOT_TOKEN

# Your Telegram numeric chat ID — see vps-setup-manual.md for how to find this
TELEGRAM_CHAT_ID=REPLACE_WITH_CHAT_ID

# Supabase project URL — from Supabase dashboard → Settings → API
SUPABASE_URL=https://REPLACE.supabase.co

# Supabase service role key — from Supabase dashboard → Settings → API → service_role
# Keep this secret. Rotate immediately if VPS is compromised.
SUPABASE_SERVICE_KEY=REPLACE_WITH_SERVICE_ROLE_KEY

# Optional: override test URLs here instead of setting them in Supabase extension_config.
# Leave blank to use the Supabase table values (preferred).
MONITOR_LUMA_URL=
MONITOR_LINKEDIN_URL=
ENVEOF
  chown "${IHN_USER}:${IHN_USER}" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "  Created ${ENV_FILE} template. Fill it in before starting the bot."
fi

# ============================================================
echo "=== Step 8: Create ~/repos/ and ~/logs/ directories ==="
# ============================================================
sudo -u "${IHN_USER}" mkdir -p "/home/${IHN_USER}/repos"
sudo -u "${IHN_USER}" mkdir -p "${LOGS_DIR}"
echo "  Directories ready."

# ============================================================
echo "=== Step 9: Clone IHN repo ==="
# ============================================================
if [ -d "${REPO_DIR}/.git" ]; then
  echo "  Repo already cloned at ${REPO_DIR} — skipping."
else
  sudo -u "${IHN_USER}" git clone "${REPO_URL}" "${REPO_DIR}"
  echo "  Cloned ${REPO_URL} to ${REPO_DIR}."
fi

# ============================================================
echo "=== Step 10: npm install in bot/ ==="
# ============================================================
run_as_ihn "cd ${REPO_DIR}/bot && npm install"
echo "  bot/ dependencies installed."

# ============================================================
echo "=== Step 11: Install Playwright Chromium browser ==="
# ============================================================
run_as_ihn "cd ${REPO_DIR} && npx playwright install chromium"
echo "  Playwright Chromium installed."

# ============================================================
echo "=== Step 12: Register MCP servers with Claude Code ==="
# ============================================================
# Check if already registered to stay idempotent
if run_as_ihn "claude mcp list 2>/dev/null | grep -q playwright"; then
  echo "  playwright MCP already registered — skipping."
else
  run_as_ihn "claude mcp add --transport stdio playwright -- npx -y @playwright/mcp@latest --user-data-dir ~/.cache/ms-playwright/ihn-profile"
  echo "  Registered playwright MCP."
fi

if run_as_ihn "claude mcp list 2>/dev/null | grep -q supabase"; then
  echo "  supabase MCP already registered — skipping."
else
  run_as_ihn "claude mcp add --transport http supabase https://mcp.supabase.com/mcp"
  echo "  Registered supabase MCP."
fi

if run_as_ihn "claude mcp list 2>/dev/null | grep -q github"; then
  echo "  github MCP already registered — skipping."
else
  run_as_ihn "claude mcp add --transport http github https://api.githubcopilot.com/mcp/"
  echo "  Registered github MCP."
fi

# ============================================================
echo "=== Step 13: Start bot with pm2 ==="
# ============================================================
if run_as_ihn "pm2 list | grep -q ihn-bot"; then
  echo "  ihn-bot already running in pm2 — skipping. Run 'pm2 restart ihn-bot' to restart."
else
  # Ensure .env is loaded — bot/index.js uses dotenv with /etc/ihn-agent/.env path
  run_as_ihn "pm2 start ${REPO_DIR}/bot/index.js --name ihn-bot"
  echo "  ihn-bot started."
fi

# ============================================================
echo "=== Step 14: Save pm2 process list and configure startup ==="
# ============================================================
run_as_ihn "pm2 save"
# pm2 startup must run as root to register the systemd service
PM2_STARTUP_CMD=$(sudo -u "${IHN_USER}" bash -c "source ~/.nvm/nvm.sh && pm2 startup systemd -u ${IHN_USER} --hp /home/${IHN_USER}" | grep "sudo env")
if [ -n "${PM2_STARTUP_CMD}" ]; then
  eval "${PM2_STARTUP_CMD}"
  echo "  pm2 startup configured."
else
  echo "  pm2 startup already configured or no command returned — check manually."
fi

# ============================================================
echo "=== Step 15: Add cron jobs ==="
# ============================================================
CRON_HEALTH="0 3 * * * source /home/${IHN_USER}/.nvm/nvm.sh && node ${REPO_DIR}/monitor/health-check.js >> ${LOGS_DIR}/health-check.log 2>&1"
CRON_ALERTS="0 * * * * source /home/${IHN_USER}/.nvm/nvm.sh && node ${REPO_DIR}/monitor/poll-alerts.js >> ${LOGS_DIR}/poll-alerts.log 2>&1"

# Add cron jobs for ihn user if not already present
(sudo -u "${IHN_USER}" crontab -l 2>/dev/null || true) | {
  EXISTING=$(cat)
  NEW_CRONS="${EXISTING}"
  if ! echo "${EXISTING}" | grep -q "health-check.js"; then
    NEW_CRONS="${NEW_CRONS}"$'\n'"${CRON_HEALTH}"
    echo "  Added health-check cron."
  else
    echo "  health-check cron already present — skipping."
  fi
  if ! echo "${EXISTING}" | grep -q "poll-alerts.js"; then
    NEW_CRONS="${NEW_CRONS}"$'\n'"${CRON_ALERTS}"
    echo "  Added poll-alerts cron."
  else
    echo "  poll-alerts cron already present — skipping."
  fi
  echo "${NEW_CRONS}" | sudo -u "${IHN_USER}" crontab -
}

# ============================================================
echo ""
echo "=== Setup complete. Manual steps remaining: ==="
echo ""
echo "  1. Fill in ${ENV_FILE} with real values:"
echo "       TELEGRAM_BOT_TOKEN   — from @BotFather on Telegram"
echo "       TELEGRAM_CHAT_ID     — see vps-setup-manual.md for how to find this"
echo "       SUPABASE_URL         — Supabase dashboard → Settings → API"
echo "       SUPABASE_SERVICE_KEY — Supabase dashboard → Settings → API → service_role key"
echo ""
echo "  2. Authenticate Claude Code (one-time, interactive):"
echo "       su - ${IHN_USER}"
echo "       claude"
echo "     Follow the login prompts. This authenticates with your Anthropic account."
echo ""
echo "  3. Log into Luma + LinkedIn in the persistent Playwright browser (one-time):"
echo "       su - ${IHN_USER}"
echo "       npx playwright open --user-data-dir ~/.cache/ms-playwright/ihn-profile https://lu.ma"
echo "     Log in to Luma, then navigate to LinkedIn and log in there too."
echo "     Close the browser. The session is saved to the profile directory."
echo "     (Requires X forwarding or a VNC session for the headed browser.)"
echo ""
echo "  4. Set monitor test URLs in Supabase:"
echo "       Go to Supabase dashboard → Table Editor → extension_config"
echo "       Set monitor_test_luma_url  = a stable public Luma event URL"
echo "       Set monitor_test_linkedin_url = any public LinkedIn profile URL"
echo "         (your own works: https://www.linkedin.com/in/tingyi-jenny-chen/)"
echo ""
echo "  5. Set up UptimeRobot:"
echo "       Sign up at uptimerobot.com"
echo "       Create HTTP monitor for: http://<VPS-IP>:3456/health"
echo "       Set check interval: 5 minutes"
echo "       Add Telegram notification channel"
echo ""
echo "  6. Restart the bot after filling in .env:"
echo "       pm2 restart ihn-bot && pm2 logs ihn-bot"
echo ""
echo "  7. (Recommended) Take a Hetzner snapshot now as your restore point."
echo ""
