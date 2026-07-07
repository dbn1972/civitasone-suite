-- Purpose: Add transcripts table for call recording transcription.
-- Rollback: DROP TABLE IF EXISTS telephony.transcripts;
-- Affected services: telephony-service
SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS telephony.transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  call_id UUID NOT NULL,
  recording_id UUID NOT NULL,
  text TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  duration_ms INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL,
  updated_by UUID NOT NULL,
  version INT NOT NULL DEFAULT 1,
  CONSTRAINT chk_transcripts_status CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT chk_transcripts_text_length CHECK (char_length(text) <= 500000)
);

-- Indexes for transcripts
CREATE INDEX IF NOT EXISTS idx_transcripts_tenant_call
  ON telephony.transcripts (tenant_id, call_id);

CREATE INDEX IF NOT EXISTS idx_transcripts_recording
  ON telephony.transcripts (recording_id);

CREATE INDEX IF NOT EXISTS idx_transcripts_status
  ON telephony.transcripts (status) WHERE status = 'pending';

-- RLS for transcripts
ALTER TABLE telephony.transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE telephony.transcripts FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'transcripts' AND schemaname = 'telephony' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON telephony.transcripts
      USING (tenant_id = current_tenant_id())
      WITH CHECK (tenant_id = current_tenant_id());
  END IF;
END $$;
