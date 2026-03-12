'use strict';

// Regression test: guards against LinkedIn flipping JSESSIONID to HttpOnly,
//   which would break the Voyager API CSRF token approach used by the extension.
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

    // Check what JS can see via document.cookie
    const jsCookies = await page.evaluate(() => document.cookie);
    const jsCanSeeJsessionid = jsCookies.includes('JSESSIONID');

    if (jsCanSeeJsessionid) {
      console.log('✓ LinkedIn: JSESSIONID readable from JS context');
      process.exit(0);
    }

    // JS can't see it — check whether the browser has it at all (to distinguish
    // "cookie missing" from "cookie present but HttpOnly")
    const allCookies = await browser.cookies();
    const browserCookie = allCookies.find(
      c => c.name === 'JSESSIONID' && c.domain.includes('linkedin.com')
    );

    if (browserCookie) {
      // Cookie exists in browser but not visible to JS — it's HttpOnly
      console.log(
        'FAIL linkedin-csrf-accessible: JSESSIONID is present in browser cookies but NOT in document.cookie — LinkedIn has set it HttpOnly. Voyager API approach will fail.'
      );
    } else {
      console.log(
        'FAIL linkedin-csrf-accessible: JSESSIONID not in document.cookie — LinkedIn may have set it HttpOnly. Voyager API approach will fail.'
      );
    }
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('linkedin-csrf-accessible fatal:', err);
  process.exit(1);
});
