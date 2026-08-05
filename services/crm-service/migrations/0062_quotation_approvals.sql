-- Purpose: QP-004 — quotation discount / deviation approval workflow. A quotation whose
--   discount or deviation breaches a configured threshold cannot be issued (sent) as a
--   final quotation unless an approval row for it has been APPROVED. crm.approval_thresholds
--   holds the per-tenant policy; crm.quotation_approvals is the request/decision ledger.
-- Rollback: DROP TABLE IF EXISTS crm.quotation_approvals;
--           DROP TABLE IF EXISTS crm.approval_thresholds;
-- Affected services: crm-service (deals / quotations module)

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.approval_thresholds (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  approval_type  varchar(16) NOT NULL
    CHECK (approval_type IN ('discount','deviation','credit','commercial')),
  -- Discount percentage (basis points, 0-10000) at or below which no approval is needed.
  max_discount_bps integer NOT NULL DEFAULT 0 CHECK (max_discount_bps BETWEEN 0 AND 10000),
  -- Role permitted to approve a breach of this threshold.
  requires_role  varchar(64) NOT NULL DEFAULT 'crm_admin',
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_approval_thresholds_tenant_type
  ON crm.approval_thresholds (tenant_id, approval_type);

CREATE TABLE IF NOT EXISTS crm.quotation_approvals (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  quotation_id      uuid NOT NULL,
  approval_type     varchar(16) NOT NULL
    CHECK (approval_type IN ('discount','deviation','credit','commercial')),
  status            varchar(12) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  -- Snapshot of what breached, e.g. { "discountBps": 2500, "maxDiscountBps": 1000 }.
  threshold_breached jsonb NOT NULL DEFAULT '{}',
  reason            text,
  requested_by      uuid NOT NULL,
  approver          uuid,
  decided_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotation_approvals_quotation
  ON crm.quotation_approvals (tenant_id, quotation_id, status);

DO $iso$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['approval_thresholds','quotation_approvals'] LOOP
    EXECUTE format('ALTER TABLE crm.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE crm.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='crm' AND tablename=t
        AND policyname = t || '_tenant_isolation') THEN
      EXECUTE format('CREATE POLICY %I ON crm.%I USING (tenant_id::text = current_setting(''app.tenant_id'', true))',
        t || '_tenant_isolation', t);
    END IF;
  END LOOP;
END $iso$;

DO $g$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.approval_thresholds TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.quotation_approvals TO crm_svc;
  END IF;
END $g$;
