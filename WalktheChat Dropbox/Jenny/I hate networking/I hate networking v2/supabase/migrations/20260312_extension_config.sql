CREATE TABLE IF NOT EXISTS extension_config (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE extension_config ENABLE ROW LEVEL SECURITY;

-- Allow anon read (extension reads without auth)
CREATE POLICY "anon_read_extension_config"
  ON extension_config FOR SELECT
  TO anon
  USING (true);

-- Only service role can write (monitor + ihn-ops agent)
-- (no INSERT/UPDATE policy for anon — service key required to update)

-- Seed initial values
INSERT INTO extension_config (key, value) VALUES
  ('luma_button_labels',        '["Guests","Going","Attendees","See all","Went","Registered","and N others"]'::jsonb),
  ('luma_api_pattern',          '"(guest|guests|ticket|tickets|attendee|attendees|rsvp|participant|participants)"'::jsonb),
  ('luma_next_data_path',       '"props.pageProps.initialData.user"'::jsonb),
  ('monitor_test_luma_url',     '"<fill-before-first-monitor-run>"'::jsonb),
  ('monitor_test_linkedin_url', '"<fill-before-first-monitor-run>"'::jsonb)
ON CONFLICT (key) DO NOTHING;
