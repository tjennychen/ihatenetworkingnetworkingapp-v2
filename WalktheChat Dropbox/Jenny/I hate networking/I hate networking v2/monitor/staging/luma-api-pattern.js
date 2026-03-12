'use strict';

// Regression test: guards against Luma changing their API URL structure so
//   the extension can no longer intercept guest/attendee data via XHR.
// Move to monitor/ to activate (currently staged)

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PROFILE_DIR = process.env.PLAYWRIGHT_PROFILE || `${process.env.HOME}/.cache/ms-playwright/ihn-profile`;

const DEFAULTS = {
  monitor_test_luma_url: process.env.MONITOR_LUMA_URL || '',
  luma_api_pattern: '(guest|guests|ticket|tickets|attendee|attendees|rsvp|participant|participants)',
};

async function fetchConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return DEFAULTS;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from('extension_config')
      .select('key, value')
      .in('key', ['monitor_test_luma_url', 'luma_api_pattern']);
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

async function main() {
  const config = await fetchConfig();

  if (!config.monitor_test_luma_url) {
    console.error('ERROR: monitor_test_luma_url must be set in Supabase extension_config or .env');
    process.exit(1);
  }

  const pattern = config.luma_api_pattern || DEFAULTS.luma_api_pattern;
  const regex = new RegExp(pattern, 'i');

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });

  try {
    const page = await browser.newPage();

    const observedLumaUrls = [];

    page.on('request', req => {
      const type = req.resourceType();
      const url = req.url();
      if ((type === 'fetch' || type === 'xhr') && url.includes('lu.ma')) {
        observedLumaUrls.push(url);
      }
    });

    await page.goto(config.monitor_test_luma_url, { waitUntil: 'networkidle', timeout: 30000 });

    // Wait an extra 5s to capture XHR requests that fire after initial render
    await page.waitForTimeout(5000);

    const matchingUrl = observedLumaUrls.find(url => regex.test(url));

    if (matchingUrl) {
      console.log(`✓ Luma: API pattern matched: ${matchingUrl}`);
      process.exit(0);
    } else {
      console.log(
        `FAIL luma-api-pattern: no request matched pattern /${pattern}/. Observed lu.ma API calls: [${observedLumaUrls.slice(0, 20).join(', ')}]`
      );
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('luma-api-pattern fatal:', err);
  process.exit(1);
});
