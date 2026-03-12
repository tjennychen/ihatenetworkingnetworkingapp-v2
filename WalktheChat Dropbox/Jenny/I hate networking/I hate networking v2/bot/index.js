'use strict';

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const TelegramBot = require('node-telegram-bot-api');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const db = require('./db');

// ── Config ────────────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const PORT = 3456;
const START_TIME = Date.now();
const SESSIONS_DIR = path.join(__dirname, 'sessions');
const LAST_POLL_FILE = path.join(__dirname, '..', 'monitor', '.last-poll');
const LAST_RUN_FILE = path.join(__dirname, '..', 'monitor', '.last-run');
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const MAX_THREAD_MESSAGES = 20;
const THREAD_EXPIRE_MS = 24 * 60 * 60 * 1000;
const TELEGRAM_MAX_CHARS = 4000;

if (!BOT_TOKEN) { console.error('TELEGRAM_BOT_TOKEN not set'); process.exit(1); }
if (!CHAT_ID)   { console.error('TELEGRAM_CHAT_ID not set');   process.exit(1); }

// Ensure sessions dir exists with restricted permissions
fs.mkdirSync(SESSIONS_DIR, { mode: 0o700, recursive: true });

// ── Telegram bot (polling) ────────────────────────────────────────────────────

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ── HTTP server (alert mode + health endpoint) ────────────────────────────────

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: Math.floor((Date.now() - START_TIME) / 1000) }));
    return;
  }

  if (req.method === 'POST' && req.url === '/send') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { text, parse_mode } = JSON.parse(body);
        if (!text) { res.writeHead(400); res.end('{"error":"text required"}'); return; }
        bot.sendMessage(CHAT_ID, text, parse_mode ? { parse_mode } : {})
          .then(() => { res.writeHead(200); res.end('{"ok":true}'); })
          .catch(err => { console.error('bot.sendMessage error:', err.message); res.writeHead(500); res.end('{"error":"send failed"}'); });
      } catch (e) {
        res.writeHead(400); res.end('{"error":"invalid json"}');
      }
    });
    return;
  }

  res.writeHead(404); res.end('not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`IHN bot HTTP server listening on 127.0.0.1:${PORT}`);
});

// ── Session helpers ───────────────────────────────────────────────────────────

function sessionFile(chatId) {
  return path.join(SESSIONS_DIR, `${chatId}.json`);
}

function loadSession(chatId) {
  try {
    const raw = fs.readFileSync(sessionFile(chatId), 'utf8');
    const session = JSON.parse(raw);
    // Expire if last message > 24h ago
    if (session.messages && session.messages.length > 0) {
      const lastTs = session.messages[session.messages.length - 1].ts;
      if (Date.now() - new Date(lastTs).getTime() > THREAD_EXPIRE_MS) {
        return newSession();
      }
    }
    return session;
  } catch {
    return newSession();
  }
}

function newSession() {
  return { started_at: new Date().toISOString(), messages: [] };
}

function saveSession(chatId, session) {
  // Keep last N messages
  if (session.messages.length > MAX_THREAD_MESSAGES) {
    session.messages = session.messages.slice(-MAX_THREAD_MESSAGES);
  }
  fs.writeFileSync(sessionFile(chatId), JSON.stringify(session, null, 2), { mode: 0o600 });
}

function clearSession(chatId) {
  try { fs.unlinkSync(sessionFile(chatId)); } catch {}
}

// ── Claude invocation ─────────────────────────────────────────────────────────

function buildClaudePrompt(userMessage, session) {
  const contextLines = session.messages.slice(-10).map(m => `[${m.role}]: ${m.content}`).join('\n');
  const threadBlock = contextLines ? `\nThread context (recent messages):\n${contextLines}\n` : '';
  return `${userMessage}${threadBlock}
You have access to playwright-mcp, supabase-mcp, github-mcp. Repo is at ~/repos/ihn-v2/. Check .claude/agents/ihn-ops.md for IHN-specific context.`;
}

function invokeClaudeCode(prompt) {
  const allowedTools = 'playwright-mcp,supabase-mcp,github-mcp,Read,Write,Edit,Bash,Glob,Grep';
  const result = spawnSync(
    'claude',
    ['-p', prompt, '--allowedTools', allowedTools],
    { timeout: CLAUDE_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
  );

  if (result.error) {
    if (result.error.code === 'ETIMEDOUT') return null; // timeout signal
    throw result.error;
  }

  return (result.stdout || '') + (result.stderr || '');
}

// ── Send helpers ──────────────────────────────────────────────────────────────

function sendChunked(chatId, text, opts) {
  const chunks = [];
  for (let i = 0; i < text.length; i += TELEGRAM_MAX_CHARS) {
    chunks.push(text.slice(i, i + TELEGRAM_MAX_CHARS));
  }
  // Send sequentially via promise chain to preserve order
  return chunks.reduce((p, chunk) => p.then(() => bot.sendMessage(chatId, chunk, opts || {})), Promise.resolve());
}

// ── Command handlers ──────────────────────────────────────────────────────────

async function handleStatus(chatId) {
  let lastPoll = 'unknown';
  let lastRun = 'unknown';
  try { lastPoll = fs.readFileSync(LAST_POLL_FILE, 'utf8').trim(); } catch {}
  try { lastRun  = fs.readFileSync(LAST_RUN_FILE,  'utf8').trim(); } catch {}

  const lines = [
    '*IHN Monitor Status*',
    `Last poll: \`${lastPoll}\``,
    `Last health check: \`${lastRun}\``,
    `Bot uptime: ${Math.floor((Date.now() - START_TIME) / 1000)}s`,
  ];
  await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
}

async function handleHealth(chatId) {
  try {
    const { total, empty, avg } = await db.scanSummary();
    const lines = [
      '*Scan log — last 24h*',
      `Total scans: ${total}`,
      `Empty scans (0 contacts): ${empty}`,
      `Avg contacts found: ${avg}`,
    ];
    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    await bot.sendMessage(chatId, `Supabase error: ${err.message}`);
  }
}

async function handleLogs(chatId) {
  try {
    const { total, breakdown } = await db.queueErrorBreakdown();
    const lines = [`*connection\\_queue errors — last 7 days* (${total} total)`];
    for (const [reason, count] of Object.entries(breakdown).sort((a, b) => b[1] - a[1])) {
      lines.push(`  \`${reason}\`: ${count}`);
    }
    if (lines.length === 1) lines.push('No errors found.');
    await bot.sendMessage(chatId, lines.join('\n'), { parse_mode: 'Markdown' });
  } catch (err) {
    await bot.sendMessage(chatId, `Supabase error: ${err.message}`);
  }
}

async function handleClear(chatId) {
  clearSession(chatId);
  await bot.sendMessage(chatId, 'Thread cleared.');
}

// ── Main message handler ──────────────────────────────────────────────────────

bot.on('message', async (msg) => {
  const fromId = String(msg.chat.id);

  // Only respond to the configured chat
  if (fromId !== String(CHAT_ID)) return;

  const text = (msg.text || '').trim();
  if (!text) return;

  // Commands
  if (text === '/status') { await handleStatus(fromId); return; }
  if (text === '/health') { await handleHealth(fromId); return; }
  if (text === '/logs')   { await handleLogs(fromId);   return; }
  if (text === '/clear')  { await handleClear(fromId);  return; }

  // Conversation mode — route to Claude Code
  const session = loadSession(fromId);
  session.messages.push({ role: 'user', content: text, ts: new Date().toISOString() });

  const prompt = buildClaudePrompt(text, session);

  await bot.sendMessage(fromId, '_Thinking..._', { parse_mode: 'Markdown' });

  let claudeOutput;
  try {
    claudeOutput = invokeClaudeCode(prompt);
  } catch (err) {
    await bot.sendMessage(fromId, `Claude invocation error: ${err.message}`);
    return;
  }

  if (claudeOutput === null) {
    await bot.sendMessage(fromId, 'Claude timed out — try again or check VPS logs.');
    return;
  }

  session.messages.push({ role: 'assistant', content: claudeOutput.slice(0, 2000), ts: new Date().toISOString() });
  saveSession(fromId, session);

  await sendChunked(fromId, claudeOutput || '(no output)');

  // "ship it" reminder
  if (text.toLowerCase().includes('ship it')) {
    await bot.sendMessage(fromId, 'Reminder: Claude will create a PR branch. Check GitHub to review + merge.');
  }
});

bot.on('polling_error', (err) => {
  console.error('Telegram polling error:', err.message);
});

console.log('IHN bot started.');
