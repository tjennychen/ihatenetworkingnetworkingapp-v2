'use strict';

// Lightweight nightly DOM monitor — no AI, no Claude.
// Runs at 3am via cron. Wakes Claude only on failure.

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const { execSync } = require('child_process');
const https = require('https');
const path = require('path');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const PROFILE_DIR = process.env.PLAYWRIGHT_PROFILE || `${process.env.HOME}/.cache/ms-playwright/ihn-profile`;

const DEFAULTS = {
  luma_button_labels: ['Guests', 'Going', 'Attendees', 'See all', 'Went', 'Registered'],
  monitor_test_luma_url: process.env.MONITOR_LUMA_URL || '',
  monitor_test_linkedin_url: process.env.MONITOR_LINKEDIN_URL || '',
};

async function fetchConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return DEFAULTS;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from('extension_config')
      .select('key, value')
      .in('key', ['luma_button_labels', 'monitor_test_luma_url', 'monitor_test_linkedin_url']);
    if (error || !data) return DEFAULTS;
    const cfg = { ...DEFAULTS };
    for (const row of data) {
      cfg[row.key] = typeof row.value === 'string' ? row.value : row.value;
    }
    return cfg;
  } catch {
    return DEFAULTS;
  }
}

function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  const body = JSON.stringify({ chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' });
  const req = https.request({
    hostname: 'api.telegram.org',
    path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
  });
  req.write(body);
  req.end();
}

async function main() {
  const config = await fetchConfig();

  if (!config.monitor_test_luma_url || !config.monitor_test_linkedin_url) {
    console.error('ERROR: monitor_test_luma_url and monitor_test_linkedin_url must be set in Supabase extension_config or .env');
    process.exit(1);
  }

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  const failures = [];

  // ── Luma check ─────────────────────────────────────────────────────────────
  try {
    const page = await browser.newPage();
    await page.goto(config.monitor_test_luma_url, { waitUntil: 'networkidle', timeout: 30000 });

    const labels = Array.isArray(config.luma_button_labels)
      ? config.luma_button_labels
      : JSON.parse(config.luma_button_labels);

    let clicked = false;
    let foundButtonTexts = [];
    const buttons = await page.$$('button, [role="button"]');
    for (const btn of buttons) {
      const text = (await btn.textContent() || '').trim();
      foundButtonTexts.push(text);
      if (labels.some(l => text.includes(l))) {
        await btn.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      failures.push({ test: 'luma', reason: 'button_not_found', buttonTexts: foundButtonTexts.slice(0, 20), guestCount: 0 });
    } else {
      await page.waitForTimeout(3000);
      const guestLinks = await page.$$('a[href*="/u/"], a[href*="/user/"]');
      const guestCount = guestLinks.length;
      if (guestCount === 0) {
        failures.push({ test: 'luma', reason: 'no_guest_links_after_click', buttonTexts: foundButtonTexts.slice(0, 20), guestCount: 0 });
      } else {
        console.log(`✓ Luma: ${guestCount} guest link(s) found`);
      }
    }
    await page.close();
  } catch (err) {
    failures.push({ test: 'luma', reason: `exception: ${err.message}`, buttonTexts: [], guestCount: 0 });
  }

  // ── LinkedIn check ─────────────────────────────────────────────────────────
  let linkedinSessionExpired = false;
  try {
    const page = await browser.newPage();
    await page.goto(config.monitor_test_linkedin_url, { waitUntil: 'networkidle', timeout: 30000 });

    const finalUrl = page.url();
    if (finalUrl.includes('/login') || finalUrl.includes('/authwall') || finalUrl.includes('/checkpoint')) {
      linkedinSessionExpired = true;
    } else {
      const cookies = await browser.cookies();
      const hasSession = cookies.some(c => c.name === 'JSESSIONID' && c.domain.includes('linkedin.com'));
      if (!hasSession) {
        linkedinSessionExpired = true;
      } else {
        // Check for a profile button (Connect, Follow, More, Message, Resources)
        const buttons = await page.$$('button, [role="button"], a[role="button"]');
        let found = false;
        for (const btn of buttons) {
          const text = (await btn.textContent() || '').trim();
          if (['Connect', 'More', 'Resources', 'Follow', 'Message'].some(t => text.includes(t))) {
            found = true;
            break;
          }
        }
        if (!found) {
          const allTexts = [];
          for (const btn of buttons.slice(0, 30)) {
            allTexts.push((await btn.textContent() || '').trim());
          }
          failures.push({ test: 'linkedin', reason: 'no_profile_buttons_found', buttonTexts: allTexts, guestCount: 0 });
        } else {
          console.log('✓ LinkedIn: profile buttons found, session valid');
        }
      }
    }
    await page.close();
  } catch (err) {
    failures.push({ test: 'linkedin', reason: `exception: ${err.message}`, buttonTexts: [], guestCount: 0 });
  }

  await browser.close();

  if (linkedinSessionExpired) {
    sendTelegram('*IHN Monitor* LinkedIn session expired — please re-login on VPS via SSH and headed browser.');
    console.log('LinkedIn session expired alert sent. Not a code bug.');
    // Don't exit 1 — this isn't a DOM break
  }

  if (failures.length === 0) {
    console.log('✓ All checks passed');
    process.exit(0);
  }

  // Wake Claude for DOM failures
  const wakeScript = path.join(__dirname, 'wake-claude.js');
  for (const failure of failures) {
    execSync(`node ${wakeScript} '${JSON.stringify(failure)}'`, { stdio: 'inherit' });
  }
  process.exit(1);
}

main().catch(err => {
  console.error('health-check fatal:', err);
  process.exit(1);
});
