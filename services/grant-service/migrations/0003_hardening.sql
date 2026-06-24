-- 0003 production hardening (grant-service)
-- Additive + idempotent only. Covers P0-2/P0-3 (UC validation + tranche linkage),
-- P0-4 (gapless sanction counter), and P1-1 (SoD maker/checker columns).

-- ── P1-1 SoD: maker / checker on applications ─────────────────────
ALTER TABLE application.grant_applications
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS approved_by  uuid;

-- ── P0-4 gapless per-(tenant,FY) sanction counter ─────────────────
CREATE TABLE IF NOT EXISTS application.grant_sanction_counters (
  tenant_id uuid        NOT NULL,
  fy        varchar(9)  NOT NULL,
  next_val  bigint      NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, fy)
);

-- ── P0-3 UC ↔ tranche linkage + P0-2 validation state ─────────────
ALTER TABLE utilisation.grant_uc_statements
  ADD COLUMN IF NOT EXISTS installment_no     integer     NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS validation_status  varchar(24) NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS validated_by       uuid,
  ADD COLUMN IF NOT EXISTS validated_at       timestamptz,
  ADD COLUMN IF NOT EXISTS validation_remarks text;

-- Fast lookup for the next-tranche gate (tenant + application + tranche + status).
CREATE INDEX IF NOT EXISTS idx_uc_tranche_gate
  ON utilisation.grant_uc_statements (tenant_id, application_id, installment_no, validation_status);

-- ── P0-2 persisted UC validation decisions (replaces in-memory store) ──
CREATE TABLE IF NOT EXISTS utilisation.grant_uc_validations (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid        NOT NULL,
  uc_id        uuid        NOT NULL,
  status       varchar(24) NOT NULL,
  remarks      text,
  validated_by uuid        NOT NULL,
  validated_at timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_uc_validations_uc
  ON utilisation.grant_uc_validations (tenant_id, uc_id);
