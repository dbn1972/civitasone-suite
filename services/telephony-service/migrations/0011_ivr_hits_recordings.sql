-- Purpose: Add ivr_hits and recordings tables to the telephony schema.
-- Rollback: DROP TABLE IF EXISTS telephony.ivr_hits; DROP TABLE IF EXISTS telephony.recordings;
-- Affected services: telephony-service
SET lock_timeout = '5s';

-- ── IVR Hits table ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telephony.ivr_hits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  call_id UUID NOT NULL,
  menu_key VARCHAR(64) NOT NULL,
  digit VARCHAR(8) NOT NULL,
  "timestamp" TIMESTAMPTZ NOT NULL,
  ordinal INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_ivr_hits_ordinal CHECK (ordinal >= 1 AND ordinal <= 50),
  CONSTRAINT chk_ivr_hits_digit CHECK (digit ~ '^[0-9*#]+$')
);

-- Indexes for ivr_hits
CREATE INDEX IF NOT EXISTS idx_ivr_hits_tenant_call
  ON telephony.ivr_hits (tenant_id, call_id);

CREATE INDEX IF NOT EXISTS idx_ivr_hits_call_ordinal
  ON telephony.ivr_hits (call_id, ordinal);

-- RLS for ivr_hits
ALTER TABLE telephony.ivr_hits ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.ivr_hits FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'ivr_hits' AND schemaname = 'telephony' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON telephony.ivr_hits
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;

-- ── Recordings table ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS telephony.recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  call_id UUID NOT NULL,
  recording_url VARCHAR(512) NOT NULL,
  storage_key VARCHAR(512),
  duration_sec INT,
  format VARCHAR(16) NOT NULL DEFAULT 'mp3',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_recordings_status CHECK (status IN ('pending', 'stored', 'failed')),
  CONSTRAINT chk_recordings_format CHECK (format IN ('mp3', 'wav', 'ogg', 'opus'))
);

-- Indexes for recordings
CREATE INDEX IF NOT EXISTS idx_recordings_tenant_call
  ON telephony.recordings (tenant_id, call_id);

CREATE INDEX IF NOT EXISTS idx_recordings_status
  ON telephony.recordings (status) WHERE status = 'pending';

-- RLS for recordings
ALTER TABLE telephony.recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.recordings FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'recordings' AND schemaname = 'telephony' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON telephony.recordings
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;
