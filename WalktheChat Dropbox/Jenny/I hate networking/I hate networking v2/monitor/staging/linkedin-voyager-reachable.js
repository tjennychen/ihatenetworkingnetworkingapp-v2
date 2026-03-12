'use strict';

// Regression test: guards against LinkedIn changing or removing the Voyager API
//   endpoint used to send connection invitations.
// Move to monitor/ to activate (currently staged)

require('dotenv').config({ path: '/etc/ihn-agent/.env' });

const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || '';
const PROFILE_DIR = process.env.PLAYWRIGHT_PROFILE || `${process.env.HOME}/.cache/ms-playwright/ihn-profile`;

const VOYAGER_ENDPOINT =
  'https://www.linkedin.com/voyager/api/voyagerRelationshipsDashMemberRelationships' +
  '?action=verifyQuotaAndCreateV2' +
  '&decorationId=com.linkedin.voyager.dash.deco.relationships.InvitationCreationResultWithInvitee-2';

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

    // Probe the Voyager endpoint from within the page context (so session cookies are sent)
    const result = await page.evaluate(async (url) => {
      try {
        const resp = await fetch(url, {
          method: 'GET',
          headers: { 'csrf-token': 'probe' },
          credentials: 'include',
        });
        return { status: resp.status, ok: true };
      } catch (e) {
        return { status: null, ok: false, error: e.message };
      }
    }, VOYAGER_ENDPOINT);

    if (!result.ok) {
      console.log(`FAIL linkedin-voyager-reachable: fetch threw — ${result.error}`);
      process.exit(1);
    }

    const { status } = result;

    // 400/401/403/405/429 all mean the endpoint exists (just rejecting a bad/unauth request)
    const endpointExists = [400, 401, 403, 405, 429].includes(status);

    if (endpointExists) {
      console.log(`✓ LinkedIn: Voyager endpoint reachable (status: ${status})`);
      process.exit(0);
    } else {
      console.log(
        `FAIL linkedin-voyager-reachable: endpoint returned ${status} — URL may have changed`
      );
      process.exit(1);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('linkedin-voyager-reachable fatal:', err);
  process.exit(1);
});
