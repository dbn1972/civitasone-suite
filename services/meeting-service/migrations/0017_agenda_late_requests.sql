-- 0017_agenda_late_requests.sql
--
-- Stored "request late inclusion" flow for meeting agendas (Req 3.5). An agenda item proposed after the
-- submission cut-off needs the chairperson's approval. Until now the only path was the chair filing the
-- item directly (POST .../agenda/late); a secretary or member had nowhere to ask. This table holds the
-- request: the requester's proposed item + reason, then the chair's decision (approve => the item is
-- added to the agenda; reject => a reason). maker != checker is enforced in the route AND the consumer.
--
-- Numbering: 0016 is taken by PR #2506 (meeting record-held / per-committee notice); this is 0017.
-- Additive and idempotent. FORCE RLS fail-closed tenant policy like every meeting table.
--
-- Rollback:
--   DROP TABLE IF EXISTS meeting.agenda_late_requests;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS meeting.agenda_late_requests (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id             UUID NOT NULL,
    meeting_id            UUID NOT NULL REFERENCES meeting.meetings(id),
    title                 TEXT NOT NULL,
    description           TEXT,
    outcome_type          VARCHAR(16) NOT NULL,
    duration_minutes      INTEGER,
    presenter_id          UUID,
    category              VARCHAR(32),
    confidentiality_level VARCHAR(16),
    file_reference        TEXT,
    reason                TEXT NOT NULL,
    status                VARCHAR(16) NOT NULL DEFAULT 'pending',
    requested_by          UUID NOT NULL,
    requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_by            UUID,
    decided_at            TIMESTAMPTZ,
    decision_reason       TEXT,
    agenda_item_id        UUID,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by            UUID NOT NULL,
    updated_by            UUID NOT NULL,
    version               INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT agenda_late_requests_status_chk CHECK (status IN ('pending', 'approved', 'rejected')),
    -- maker != checker, also as a database invariant.
    CONSTRAINT agenda_late_requests_maker_checker_chk CHECK (decided_by IS NULL OR decided_by <> requested_by),
    CONSTRAINT agenda_late_requests_decision_chk CHECK (
        (status = 'pending' AND decided_by IS NULL AND decided_at IS NULL)
        OR (status IN ('approved', 'rejected') AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_meeting_agenda_late_requests_tenant
  ON meeting.agenda_late_requests (tenant_id);
CREATE INDEX IF NOT EXISTS idx_meeting_agenda_late_requests_meeting_status
  ON meeting.agenda_late_requests (tenant_id, meeting_id, status);

ALTER TABLE meeting.agenda_late_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE meeting.agenda_late_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agenda_late_requests_tenant ON meeting.agenda_late_requests;
CREATE POLICY agenda_late_requests_tenant ON meeting.agenda_late_requests
    USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'meeting_svc') THEN
    -- DELETE is for test fixtures' cleanup; no application code deletes a request (decisions are kept).
    GRANT SELECT, INSERT, UPDATE, DELETE ON meeting.agenda_late_requests TO meeting_svc;
  END IF;
END $$;
