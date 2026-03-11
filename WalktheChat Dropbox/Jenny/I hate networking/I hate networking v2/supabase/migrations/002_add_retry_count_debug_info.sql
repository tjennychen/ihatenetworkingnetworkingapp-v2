ALTER TABLE connection_queue ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE connection_queue ADD COLUMN IF NOT EXISTS debug_info text;
