-- Migration: 0038_asset_lease_schedule_claim_attachments.sql
-- fp-assets-01 finish batch (GAP-ASSETS-LEASES-07, GAP-ASSETS-INSURANCE-CLAIMS-06). Additive + idempotent.
-- Also: insurance.asset_claims.attachments -- references (S3 keys from the admin uploads presign flow,
-- not file bytes) to the supporting documents of a claim.
-- A lease created with an incremental borrowing rate (IBR) and a periodic
-- payment gets its liability discounted (present value of the payments) and a
-- full amortisation schedule (opening, interest, payment, principal, closing).
-- Leases created without them keep the user-entered liability and no schedule.
-- Rollback: DROP TABLE IF EXISTS enterprise.lease_schedule_rows;
--           ALTER TABLE enterprise.asset_leases DROP COLUMN IF EXISTS ibr_bps, payment_minor,
--             payment_frequency, schedule_periods (one DROP each).

SET lock_timeout = '5s';

ALTER TABLE insurance.asset_claims ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE enterprise.asset_leases ADD COLUMN IF NOT EXISTS ibr_bps integer;
ALTER TABLE enterprise.asset_leases ADD COLUMN IF NOT EXISTS payment_minor bigint;
ALTER TABLE enterprise.asset_leases ADD COLUMN IF NOT EXISTS payment_frequency varchar(12);
ALTER TABLE enterprise.asset_leases ADD COLUMN IF NOT EXISTS schedule_periods integer;
-- Recognition journal state on the finance side (see project_auc.gl_post_status in 0037).
ALTER TABLE enterprise.asset_leases ADD COLUMN IF NOT EXISTS gl_post_status varchar(12) NOT NULL DEFAULT 'none';
ALTER TABLE enterprise.asset_leases ADD COLUMN IF NOT EXISTS gl_journal_id uuid;
ALTER TABLE enterprise.asset_leases ADD COLUMN IF NOT EXISTS gl_post_error text;
ALTER TABLE enterprise.asset_leases DROP CONSTRAINT IF EXISTS asset_leases_gl_post_status_check;
ALTER TABLE enterprise.asset_leases ADD CONSTRAINT asset_leases_gl_post_status_check
  CHECK (gl_post_status IN ('none', 'pending', 'posted', 'failed'));
CREATE INDEX IF NOT EXISTS idx_asset_leases_gl_journal ON enterprise.asset_leases (gl_journal_id) WHERE gl_journal_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS enterprise.lease_schedule_rows (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL,
  lease_id        uuid        NOT NULL,
  seq             integer     NOT NULL,
  due_date        date        NOT NULL,
  opening_minor   bigint      NOT NULL,
  interest_minor  bigint      NOT NULL,
  payment_minor   bigint      NOT NULL,
  principal_minor bigint      NOT NULL,
  closing_minor   bigint      NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lease_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_lease_schedule_rows_tenant_lease ON enterprise.lease_schedule_rows (tenant_id, lease_id, seq);

ALTER TABLE enterprise.lease_schedule_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE enterprise.lease_schedule_rows FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON enterprise.lease_schedule_rows;
CREATE POLICY tenant_isolation_policy ON enterprise.lease_schedule_rows
  FOR ALL
  USING (tenant_id = register.current_tenant_id())
  WITH CHECK (tenant_id = register.current_tenant_id());
