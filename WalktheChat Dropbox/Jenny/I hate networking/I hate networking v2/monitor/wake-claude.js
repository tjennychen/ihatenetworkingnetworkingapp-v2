'use strict';

// Called by health-check.js when a DOM failure is detected.
// Invokes Claude Code CLI with failure context, then reports output to Telegram.

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const { execSync } = require('child_process');
const http = require('http');

const SUPABASE_PROJECT_ID = 'urgibxjxbcyvprdejplp';

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

function buildPrompt(failure) {
  return `The nightly IHN health check failed.

Failure details:
- Test: ${failure.test}
- Reason: ${failure.reason}
- Buttons found on page: ${JSON.stringify(failure.buttonTexts || [])}
- Guest links found: ${failure.guestCount ?? 'N/A'}

Before starting, read \`.claude/agents/ihn-ops.md\` for known break patterns — it has a table of every recurring failure type and its likely cause. Match the failure reason above to a known pattern first.

Then use playwright-mcp (\`browser_navigate\`, \`browser_take_screenshot\`, \`browser_evaluate\`) to navigate the failing page and see the actual current DOM. The persistent browser profile at \`~/.cache/ms-playwright/ihn-profile\` is already logged in.

Use supabase-mcp (project ID: ${SUPABASE_PROJECT_ID}) to query \`scan_log\` and \`monitor_alerts\` for corroboration — check for recent failures matching this pattern.

If the fix is a label change only, update \`extension_config\` in Supabase directly (no PR needed).
If the fix requires code changes: edit the relevant file, run \`npm run build\` from the \`extension/\` directory, then use github-mcp to create a PR. Send the PR link in your summary.

End your response with a short plain-English summary of: what broke, why, what you did, and what (if anything) Jenny needs to approve.`;
}

async function main() {
  const raw = process.argv[2];
  if (!raw) {
    console.error('Usage: node wake-claude.js \'{"test":"luma","reason":"...","buttonTexts":[],"guestCount":0}\'');
    process.exit(1);
  }

  let failure;
  try {
    failure = JSON.parse(raw);
  } catch (e) {
    console.error('Invalid JSON argument:', raw);
    process.exit(1);
  }

  const alertText = `*IHN Monitor* — health check FAILED\nTest: \`${failure.test}\`\nReason: \`${failure.reason}\`\nWaking Claude to investigate...`;
  sendTelegram(alertText);
  console.log('Alert sent to Telegram. Invoking Claude Code...');

  const prompt = buildPrompt(failure);
  const allowedTools = 'playwright-mcp,supabase-mcp,github-mcp,Read,Write,Edit,Bash';

  let claudeOutput = '';
  try {
    claudeOutput = execSync(
      `claude -p ${JSON.stringify(prompt)} --allowedTools "${allowedTools}" 2>&1`,
      { timeout: 300000, encoding: 'utf8' }
    );
  } catch (err) {
    claudeOutput = err.stdout || err.message || 'Claude invocation failed';
  }

  console.log('Claude output:\n', claudeOutput);

  // Send trimmed output to Telegram (max 4000 chars per message)
  const MAX = 3900;
  const trimmed = claudeOutput.length > MAX
    ? claudeOutput.slice(0, MAX) + '\n...(truncated)'
    : claudeOutput;
  sendTelegram(`*Claude investigation result:*\n\`\`\`\n${trimmed}\n\`\`\``);
}

main().catch(err => {
  console.error('wake-claude fatal:', err);
  process.exit(1);
});
