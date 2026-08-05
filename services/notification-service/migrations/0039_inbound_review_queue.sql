-- CH-07: Review queue for unmatched/ambiguous inbound contacts
-- Rollback: DROP TABLE IF EXISTS notification.inbound_review_queue;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS notification.inbound_review_queue (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  channel         varchar(16) NOT NULL,
  sender_identifier varchar(256) NOT NULL,
  message_content text,
  metadata        jsonb DEFAULT '{}'::jsonb,
  status          varchar(16) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'linked', 'discarded')),
  reason          varchar(64)
    CHECK (reason IS NULL OR reason IN ('unmatched', 'ambiguous', 'consent_conflict')),
  linked_contact_id uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_at     timestamptz,
  resolved_by     uuid
);

-- RLS + tenant isolation
ALTER TABLE notification.inbound_review_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification.inbound_review_queue FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'inbound_review_queue' AND schemaname = 'notification' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON notification.inbound_review_queue
      USING (tenant_id = current_setting('app.tenant_id', true)::uuid);
  END IF;
END $$;

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inbound_review_queue_tenant_status
  ON notification.inbound_review_queue (tenant_id, status) WHERE status = 'pending';
