'use strict';

// Hourly cron script. Checks Supabase monitor_alerts for new items since last check.
// Cron: 0 * * * *   node ~/repos/ihn-v2/monitor/poll-alerts.js

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const { createClient } = require('@supabase/supabase-js');
const http = require('http');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';

const LAST_POLL_FILE = path.join(__dirname, '.last-poll');

function readLastPoll() {
  try {
    const ts = fs.readFileSync(LAST_POLL_FILE, 'utf8').trim();
    if (ts) return ts;
  } catch {}
  // Default: 1 hour ago
  return new Date(Date.now() - 60 * 60 * 1000).toISOString();
}

function writeLastPoll(ts) {
  fs.writeFileSync(LAST_POLL_FILE, ts, 'utf8');
}

// Route all Telegram sends through the bot HTTP server (centralises token management).
function sendTelegram(text) {
  const body = JSON.stringify({ text, parse_mode: 'Markdown' });
  const req = http.request({
    hostname: '127.0.0.1',
    port: 3456,
    path: '/send',
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.on('error', err => console.error('bot /send error:', err.message));
  req.write(body);
  req.end();
}

function formatAlert(alert) {
  const ts = new Date(alert.created_at).toLocaleString('en-US', { timeZone: 'UTC', hour12: false });
  const lines = [
    `*IHN Alert* — \`${alert.alert_type || 'unknown'}\``,
    `Time: ${ts} UTC`,
  ];
  if (alert.details) {
    const details = typeof alert.details === 'string' ? alert.details : JSON.stringify(alert.details, null, 2);
    lines.push(`Details: \`${details.slice(0, 300)}\``);
  }
  return lines.join('\n');
}

async function main() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in /etc/ihn-agent/.env');
    process.exit(1);
  }

  const lastChecked = readLastPoll();
  const nowIso = new Date().toISOString();
  console.log(`Polling monitor_alerts since ${lastChecked}`);

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const { data, error } = await sb
    .from('monitor_alerts')
    .select('*')
    .gt('created_at', lastChecked)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Supabase query error:', error.message);
    process.exit(1);
  }

  const alerts = data || [];
  console.log(`Found ${alerts.length} new alert(s)`);

  for (const alert of alerts) {
    const msg = formatAlert(alert);
    sendTelegram(msg);
    console.log('Sent:', msg);
  }

  writeLastPoll(nowIso);
  process.exit(0);
}

main().catch(err => {
  console.error('poll-alerts fatal:', err);
  process.exit(1);
});
