'use strict';

// Regression test: guards against LinkedIn removing the embedded entityUrn
//   (urn:li:fsd_profile:...) from profile page HTML — the extension uses this
//   to resolve the invitee URN for Voyager API calls.
// Move to monitor/ to activate (currently staged)

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PROFILE_DIR = process.env.PLAYWRIGHT_PROFILE || `${process.env.HOME}/.cache/ms-playwright/ihn-profile`;

const DEFAULTS = {
  monitor_test_linkedin_url: process.env.MONITOR_LINKEDIN_URL || '',
};

async function fetchConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return DEFAULTS;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from('extension_config')
      .select('key, value')
      .in('key', ['monitor_test_linkedin_url']);
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

  if (!config.monitor_test_linkedin_url) {
    console.error('ERROR: monitor_test_linkedin_url must be set in Supabase extension_config or .env');
    process.exit(1);
  }

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(config.monitor_test_linkedin_url, { waitUntil: 'networkidle', timeout: 30000 });

    const finalUrl = page.url();
    if (
      finalUrl.includes('/login') ||
      finalUrl.includes('/authwall') ||
      finalUrl.includes('/checkpoint')
    ) {
      console.log('SKIP: LinkedIn session expired');
      process.exit(0);
    }

    const html = await page.content();

    // Primary check: entityUrn with fsd_profile
    const urnMatch = html.match(/"entityUrn":"(urn:li:fsd_profile:[^"]+)"/);
    if (urnMatch) {
      console.log(`✓ LinkedIn: profile URN extractable: ${urnMatch[1]}`);
      process.exit(0);
    }

    // Diagnostic: check if publicIdentifier is at least present
    const hasPublicIdentifier = html.includes('"publicIdentifier"');
    if (hasPublicIdentifier) {
      console.log(
        'FAIL linkedin-urn-extractable: publicIdentifier found but entityUrn missing — LinkedIn may have changed data embedding'
      );
    } else {
      console.log(
        'FAIL linkedin-urn-extractable: profile data not found in page source. Possible auth issue or page structure change.'
      );
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('linkedin-urn-extractable fatal:', err);
  process.exit(1);
});
