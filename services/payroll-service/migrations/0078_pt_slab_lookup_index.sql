-- 0078_pt_slab_lookup_index.sql
--
-- GAP-PAYROLL-STATUTORY-PT-04:
--  * the run engine resolves "the slab version in force on a date" per
--    (tenant, state) with MAX(effective_from) <= date; the index serves that
--    lookup and the version-timeline listing;
--  * payroll_pt_version_requests: every "create a new version" / "turn the
--    second-approver switch off" command, with its state: pending_approval
--    (waiting for a DIFFERENT administrator: maker != checker), applied,
--    declined (the approver said no), rejected (a rule failed, with its
--    code) or cancelled (a pending "turn it off" withdrawn). The route answers 202 with the command id and the UI polls it, so
--    a lost race or a rule that no longer holds is shown to the user instead
--    of looking like a save. FORCE RLS.
--  * payroll_settings.pt_version_maker_checker (DEFAULT ON): the tenant switch.
-- Idempotent.

SET lock_timeout = '5s';

CREATE INDEX IF NOT EXISTS ix_pt_tenant_state_eff_active
  ON payroll.payroll_professional_tax (tenant_id, state_code, effective_from)
  WHERE is_active;

-- Upgrade path: the first revision of this file created a smaller
-- payroll_pt_version_requests (no `kind`, only created / rejected outcome rows).
-- It held transient outcomes only, so a table without `kind` is dropped and
-- re-created in the new shape below. A table that already has the new shape is
-- left alone (its status CHECK is converged further down).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'payroll' AND table_name = 'payroll_pt_version_requests')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                      WHERE table_schema = 'payroll' AND table_name = 'payroll_pt_version_requests' AND column_name = 'kind') THEN
    DROP TABLE payroll.payroll_pt_version_requests;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS payroll.payroll_pt_version_requests (
  id             UUID PRIMARY KEY,
  tenant_id      UUID NOT NULL,
  kind           VARCHAR(16) NOT NULL DEFAULT 'version' CHECK (kind IN ('version', 'checker_off')),
  state_code     VARCHAR(4),
  effective_from DATE,
  payload        JSONB NOT NULL DEFAULT '{}'::jsonb,
  status         VARCHAR(16) NOT NULL CHECK (status IN ('pending_approval', 'applied', 'rejected', 'declined', 'cancelled')),
  code           VARCHAR(64),
  maker_id       UUID NOT NULL,
  decided_by     UUID,
  decided_at     TIMESTAMPTZ,
  decision_note  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- `cancelled` = a pending "turn the switch off" request withdrawn because the switch was turned back on.
ALTER TABLE payroll.payroll_pt_version_requests DROP CONSTRAINT IF EXISTS payroll_pt_version_requests_status_check;
ALTER TABLE payroll.payroll_pt_version_requests ADD CONSTRAINT payroll_pt_version_requests_status_check
  CHECK (status IN ('pending_approval', 'applied', 'rejected', 'declined', 'cancelled'));

CREATE INDEX IF NOT EXISTS ix_pt_version_requests_tenant_status
  ON payroll.payroll_pt_version_requests (tenant_id, status, created_at);
-- At most one pending "turn the second-approver switch off" request per tenant.
CREATE UNIQUE INDEX IF NOT EXISTS ux_pt_checker_off_pending
  ON payroll.payroll_pt_version_requests (tenant_id) WHERE kind = 'checker_off' AND status = 'pending_approval';

ALTER TABLE payroll.payroll_settings
  ADD COLUMN IF NOT EXISTS pt_version_maker_checker BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE payroll.payroll_pt_version_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.payroll_pt_version_requests FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.payroll_pt_version_requests;
CREATE POLICY tenant_isolation_policy ON payroll.payroll_pt_version_requests
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
