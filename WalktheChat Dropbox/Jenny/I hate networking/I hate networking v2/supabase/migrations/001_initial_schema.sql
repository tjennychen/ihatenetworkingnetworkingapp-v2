CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE events (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  luma_url   TEXT NOT NULL,
  name       TEXT DEFAULT '',
  date       DATE,
  city       TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE contacts (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_id         UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name             TEXT DEFAULT '',
  first_name       TEXT DEFAULT '',
  last_name        TEXT DEFAULT '',
  linkedin_url     TEXT DEFAULT '',
  linkedin_urn     TEXT DEFAULT '',
  headline         TEXT DEFAULT '',
  company          TEXT DEFAULT '',
  city             TEXT DEFAULT '',
  instagram_url    TEXT DEFAULT '',
  photo_url        TEXT DEFAULT '',
  luma_profile_url TEXT DEFAULT '',
  is_host          BOOLEAN DEFAULT FALSE,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(event_id, luma_profile_url)
);

CREATE TABLE connection_queue (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_id   UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','sent','accepted','failed')),
  scheduled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at      TIMESTAMPTZ,
  accepted_at  TIMESTAMPTZ,
  error        TEXT DEFAULT '',
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE usage_logs (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action     TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE events            ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts          ENABLE ROW LEVEL SECURITY;
ALTER TABLE connection_queue  ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_logs        ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users own events"    ON events           FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users own contacts"  ON contacts         FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users own queue"     ON connection_queue FOR ALL USING (user_id = auth.uid());
CREATE POLICY "users own logs"      ON usage_logs       FOR ALL USING (user_id = auth.uid());

-- Indexes
CREATE INDEX ON events(user_id, created_at DESC);
CREATE INDEX ON contacts(user_id, event_id);
CREATE INDEX ON connection_queue(user_id, status, scheduled_at);
CREATE INDEX ON usage_logs(user_id, action, created_at DESC);

-- 2026-02-25: add linkedin_name for LinkedIn post drafter
-- ALTER TABLE contacts ADD COLUMN IF NOT EXISTS linkedin_name TEXT DEFAULT '';
