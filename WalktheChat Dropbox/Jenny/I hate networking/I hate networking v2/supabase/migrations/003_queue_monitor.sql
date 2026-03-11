-- Queue monitor: auto-resets retriable failures every 30 min, logs summaries
-- Requires pg_cron extension

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE TABLE IF NOT EXISTS public.queue_monitor_log (
  id            uuid DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
  ran_at        timestamptz DEFAULT now(),
  resets        integer DEFAULT 0,
  sent_count    integer DEFAULT 0,
  failed_count  integer DEFAULT 0,
  pending_count integer DEFAULT 0,
  top_errors    jsonb DEFAULT '[]',
  notes         text DEFAULT ''
);

CREATE OR REPLACE FUNCTION public.ihn_queue_monitor()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_resets      integer;
  v_sent        integer;
  v_failed      integer;
  v_pending     integer;
  v_top_errors  jsonb;
BEGIN
  -- Auto-reset retriable transient failures from last 24h
  WITH reset_rows AS (
    UPDATE connection_queue
    SET status      = 'pending',
        error       = '',
        retry_count = 0,
        scheduled_at = NOW()
    WHERE status = 'failed'
      AND error IN (
        'send_unverified',
        'paywall_loop',
        'paywall_no_connect',
        'send_btn_not_found',
        'connect_not_available',
        'no_response',
        'linkedin_error'
      )
      AND scheduled_at > NOW() - INTERVAL '24 hours'
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_resets FROM reset_rows;

  SELECT COUNT(*) INTO v_sent    FROM connection_queue WHERE status = 'sent';
  SELECT COUNT(*) INTO v_failed  FROM connection_queue WHERE status = 'failed';
  SELECT COUNT(*) INTO v_pending FROM connection_queue WHERE status = 'pending';

  SELECT jsonb_agg(e ORDER BY (e->>'count')::int DESC) INTO v_top_errors
  FROM (
    SELECT jsonb_build_object('error', error, 'count', COUNT(*)) AS e
    FROM connection_queue
    WHERE status = 'failed' AND error != ''
    GROUP BY error
    ORDER BY COUNT(*) DESC
    LIMIT 5
  ) sub;

  INSERT INTO public.queue_monitor_log (resets, sent_count, failed_count, pending_count, top_errors)
  VALUES (v_resets, v_sent, v_failed, v_pending, COALESCE(v_top_errors, '[]'));
END;
$$;

-- Schedule every 30 minutes
SELECT cron.schedule('ihn-queue-monitor', '*/30 * * * *', 'SELECT public.ihn_queue_monitor()');
