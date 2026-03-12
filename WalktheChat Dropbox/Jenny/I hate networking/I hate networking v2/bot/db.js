'use strict';

// Supabase query helpers for /health and /logs commands.
// All queries use the service key — read-only ops only here.

const { createClient } = require('@supabase/supabase-js');

let _sb = null;

function getClient() {
  if (!_sb) {
    const url = process.env.SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_KEY || '';
    if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set');
    _sb = createClient(url, key);
  }
  return _sb;
}

// /health: last 24h scan_log summary
async function scanSummary() {
  const sb = getClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('scan_log')
    .select('contacts_found, created_at')
    .gte('created_at', since);
  if (error) throw error;

  const rows = data || [];
  const total = rows.length;
  const empty = rows.filter(r => (r.contacts_found || 0) === 0).length;
  const avg =
    total > 0
      ? Math.round(rows.reduce((sum, r) => sum + (r.contacts_found || 0), 0) / total)
      : 0;

  return { total, empty, avg };
}

// /logs: last 7-day connection_queue error breakdown
async function queueErrorBreakdown() {
  const sb = getClient();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from('connection_queue')
    .select('status, error_reason, created_at')
    .gte('created_at', since)
    .not('status', 'eq', 'sent');
  if (error) throw error;

  const rows = data || [];
  const counts = {};
  for (const row of rows) {
    const key = row.error_reason || row.status || 'unknown';
    counts[key] = (counts[key] || 0) + 1;
  }

  return { total: rows.length, breakdown: counts };
}

module.exports = { scanSummary, queueErrorBreakdown };
