-- 0004_milestone_installment_link.sql
-- Integration chain #4: project milestone → grant fund release.
-- A grant installment may be GATED on a physical project milestone; when the
-- project publishes project.milestone.completed, the linked installment is
-- released (disbursement initiated). Additive + idempotent.

ALTER TABLE disbursement.grant_installments
  ADD COLUMN IF NOT EXISTS milestone_id uuid;

-- Fast lookup of installments awaiting a given milestone (tenant + milestone + status).
CREATE INDEX IF NOT EXISTS idx_installments_milestone_gate
  ON disbursement.grant_installments (tenant_id, milestone_id, status);
