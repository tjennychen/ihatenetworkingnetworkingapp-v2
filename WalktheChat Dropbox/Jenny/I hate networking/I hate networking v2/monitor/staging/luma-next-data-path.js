'use strict';

// Regression test: guards against Luma removing/renaming __NEXT_DATA__ or
//   changing the props.pageProps.initialData path that the extension relies on.
// Move to monitor/ to activate (currently staged)

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PROFILE_DIR = process.env.PLAYWRIGHT_PROFILE || `${process.env.HOME}/.cache/ms-playwright/ihn-profile`;

const DEFAULTS = {
  monitor_test_luma_url: process.env.MONITOR_LUMA_URL || '',
};

async function fetchConfig() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return DEFAULTS;
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const { data, error } = await sb
      .from('extension_config')
      .select('key, value')
      .in('key', ['monitor_test_luma_url']);
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

  const browser = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });

  try {
    const page = await browser.newPage();
    await page.goto(config.monitor_test_luma_url, { waitUntil: 'networkidle', timeout: 30000 });

    const nextDataContent = await page.evaluate(() => {
      const el = document.querySelector('script#__NEXT_DATA__[type="application/json"]');
      return el ? el.textContent : null;
    });

    if (!nextDataContent) {
      console.log('FAIL luma-next-data-path: __NEXT_DATA__ script missing');
      process.exit(1);
    }

    let parsed;
    try {
      parsed = JSON.parse(nextDataContent);
    } catch (e) {
      console.log(`FAIL luma-next-data-path: __NEXT_DATA__ script found but JSON.parse failed: ${e.message}`);
      process.exit(1);
    }

    const initialData = parsed?.props?.pageProps?.initialData;
    if (!initialData) {
      const topLevelKeys = Object.keys(parsed || {});
      const pagePropsKeys = parsed?.props?.pageProps ? Object.keys(parsed.props.pageProps) : [];
      console.log(
        `FAIL luma-next-data-path: props.pageProps.initialData missing. Top-level keys: [${topLevelKeys.join(', ')}]. pageProps keys: [${pagePropsKeys.join(', ')}]`
      );
      process.exit(1);
    }

    console.log('✓ Luma: __NEXT_DATA__ path valid, initialData present');
    process.exit(0);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('luma-next-data-path fatal:', err);
  process.exit(1);
});
