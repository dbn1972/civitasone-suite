-- CH-11: Voice broadcast tables
-- Rollback: DROP TABLE IF EXISTS telephony.broadcast_recipients; DROP TABLE IF EXISTS telephony.voice_broadcasts;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS telephony.voice_broadcasts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  name            varchar(256) NOT NULL,
  flow_id         uuid,
  audio_url       varchar(512),
  tts_text        text,
  status          varchar(16) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled')),
  scheduled_at    timestamptz,
  started_at      timestamptz,
  completed_at    timestamptz,
  recipient_count int NOT NULL DEFAULT 0,
  answered_count  int NOT NULL DEFAULT 0,
  failed_count    int NOT NULL DEFAULT 0,
  retry_policy    jsonb DEFAULT '{"max_attempts": 3, "interval_seconds": 300}'::jsonb,
  created_by      uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid NOT NULL,
  version         int NOT NULL DEFAULT 1
);

-- RLS + tenant isolation
ALTER TABLE telephony.voice_broadcasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.voice_broadcasts FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'voice_broadcasts' AND schemaname = 'telephony' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON telephony.voice_broadcasts
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_voice_broadcasts_tenant_status
  ON telephony.voice_broadcasts (tenant_id, status);

-- Per-recipient outcomes
CREATE TABLE IF NOT EXISTS telephony.broadcast_recipients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  broadcast_id    uuid NOT NULL REFERENCES telephony.voice_broadcasts(id),
  contact_id      uuid NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ringing', 'answered', 'failed', 'no_answer', 'busy')),
  attempts        int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  outcome         jsonb DEFAULT '{}'::jsonb,
  tenant_id       uuid NOT NULL
);

-- RLS + tenant isolation
ALTER TABLE telephony.broadcast_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.broadcast_recipients FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'broadcast_recipients' AND schemaname = 'telephony' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON telephony.broadcast_recipients
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_broadcast_recipients_broadcast
  ON telephony.broadcast_recipients (broadcast_id, status);
