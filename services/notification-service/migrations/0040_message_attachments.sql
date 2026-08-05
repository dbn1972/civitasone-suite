-- CH-19: Message attachments with MIME validation, malware scan, and size cap
-- Rollback: DROP TABLE IF EXISTS notification.message_attachments;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS notification.message_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  conversation_id uuid,
  message_id      uuid,
  filename        varchar(256) NOT NULL,
  mime_type       varchar(128) NOT NULL,
  size_bytes      bigint NOT NULL,
  storage_key     varchar(512) NOT NULL,
  scan_status     varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (scan_status IN ('pending', 'clean', 'infected', 'error')),
  scanned_at      timestamptz,
  uploaded_by     uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS + tenant isolation
ALTER TABLE notification.message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.message_attachments FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'message_attachments' AND schemaname = 'notification' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON notification.message_attachments
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_attachments_tenant
  ON notification.message_attachments (tenant_id, created_at DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_message_attachments_conversation
  ON notification.message_attachments (conversation_id) WHERE conversation_id IS NOT NULL;
