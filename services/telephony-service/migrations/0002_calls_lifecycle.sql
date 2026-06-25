-- telephony-service: deepen telephony.calls into a full call-centre (CTI) record.
-- Applied with the telephony_svc role on civitas_telephony. Additive + idempotent.
--
-- The 0001 stub had (name, caller_number varchar, status). Phone numbers are PII
-- and move to app-layer AES-256-GCM ciphertext (longer than the old varchar), so
-- widen them to text and add a deterministic keyed blind index for lookup. The
-- free-text `name` column is dropped — a call is identified by its parties +
-- lifecycle, not a label.

-- Drop the stub label column (no longer modelled).
ALTER TABLE telephony.calls DROP COLUMN IF EXISTS name;

-- PII columns hold ciphertext (base64 of IV||tag||ct) — widen to text.
ALTER TABLE telephony.calls ALTER COLUMN caller_number TYPE text;

-- New lifecycle / routing / metadata columns.
ALTER TABLE telephony.calls
  ADD COLUMN IF NOT EXISTS direction              varchar(12)  NOT NULL DEFAULT 'inbound',
  ADD COLUMN IF NOT EXISTS caller_number_idx      text,
  ADD COLUMN IF NOT EXISTS callee_number          text,
  ADD COLUMN IF NOT EXISTS disposition            varchar(32),
  ADD COLUMN IF NOT EXISTS queue_id               uuid,
  ADD COLUMN IF NOT EXISTS agent_id               uuid,
  ADD COLUMN IF NOT EXISTS ivr_path               jsonb        NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS linked_ref_type        varchar(32),
  ADD COLUMN IF NOT EXISTS linked_ref_id          uuid,
  ADD COLUMN IF NOT EXISTS recording_id           varchar(128),
  ADD COLUMN IF NOT EXISTS recording_url          varchar(512),
  ADD COLUMN IF NOT EXISTS recording_duration_sec integer,
  ADD COLUMN IF NOT EXISTS recording_format       varchar(16),
  ADD COLUMN IF NOT EXISTS queued_at              timestamptz,
  ADD COLUMN IF NOT EXISTS ringing_at             timestamptz,
  ADD COLUMN IF NOT EXISTS answered_at            timestamptz,
  ADD COLUMN IF NOT EXISTS ended_at               timestamptz,
  ADD COLUMN IF NOT EXISTS wait_seconds           integer,
  ADD COLUMN IF NOT EXISTS talk_seconds           integer;

-- New default lifecycle state for fresh calls.
ALTER TABLE telephony.calls ALTER COLUMN status SET DEFAULT 'queued';

-- Query/index coverage for the call-log, queue board and agent board.
CREATE INDEX IF NOT EXISTS idx_calls_tenant_status  ON telephony.calls(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_created ON telephony.calls(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calls_tenant_queue   ON telephony.calls(tenant_id, queue_id) WHERE queue_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_calls_tenant_agent   ON telephony.calls(tenant_id, agent_id) WHERE agent_id IS NOT NULL;
-- Blind-index lookup: "every call from this number" without decrypting.
CREATE INDEX IF NOT EXISTS idx_calls_caller_idx     ON telephony.calls(tenant_id, caller_number_idx) WHERE caller_number_idx IS NOT NULL;
-- Linkage lookup to a grievance / helpdesk ticket (ref id only — no FK).
CREATE INDEX IF NOT EXISTS idx_calls_linked_ref     ON telephony.calls(tenant_id, linked_ref_type, linked_ref_id) WHERE linked_ref_id IS NOT NULL;
