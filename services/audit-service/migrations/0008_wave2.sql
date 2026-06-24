-- Wave 2 (additive + idempotent). Applied on civitas_audit after 0007.
-- Covers: P1-7 risk->plan linkage, P1-5 export worker columns, P2-4 ageing index.
--
-- NOTE on roles: schema `risk` is owned by civitas_admin (audit_svc has USAGE only),
-- matching 0003. Run the `risk.*` CREATE block below as civitas_admin; the
-- exports/compliance blocks run as audit_svc (those schemas are audit_svc-owned).
-- All statements are idempotent (IF NOT EXISTS) so re-running with either role is safe.

-- ===== P1-7: risk-driven audit planning (audit universe) — run as civitas_admin =====
CREATE TABLE IF NOT EXISTS risk.audit_plan_risks (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid        NOT NULL,
  plan_id    uuid        NOT NULL,
  risk_id    uuid        NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid        NOT NULL
);

-- idempotent link (one risk linked once per plan, scoped to tenant)
CREATE UNIQUE INDEX IF NOT EXISTS uq_audit_plan_risks
  ON risk.audit_plan_risks (tenant_id, plan_id, risk_id);
CREATE INDEX IF NOT EXISTS idx_audit_plan_risks_plan
  ON risk.audit_plan_risks (tenant_id, plan_id);

-- audit-universe selector: open risks ordered by score
CREATE INDEX IF NOT EXISTS idx_audit_risks_universe
  ON risk.audit_risks (tenant_id, status, risk_score DESC);

ALTER TABLE risk.audit_plan_risks OWNER TO audit_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON risk.audit_plan_risks TO audit_svc;

-- ===== P1-5: exports worker artifact metadata =====
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS row_count      integer;
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS includes_pii   boolean     NOT NULL DEFAULT false;
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS download_token text;
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS expires_at     timestamptz;
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS error          text;
ALTER TABLE exports.exports ADD COLUMN IF NOT EXISTS requested_roles text;

CREATE INDEX IF NOT EXISTS idx_exports_token
  ON exports.exports (tenant_id, download_token);

-- ===== P2-4: ageing/overdue sweep over the pending register =====
CREATE INDEX IF NOT EXISTS idx_pending_register_due
  ON compliance.audit_pending_register (tenant_id, status, due_date);
