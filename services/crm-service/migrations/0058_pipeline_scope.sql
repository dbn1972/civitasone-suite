-- Purpose: OP-002 — configurable pipelines differentiated by product/region/business
--   unit, plus per-stage mandatory fields and gate rules. The stage list is already a
--   JSONB array on crm.pipelines (see 0018/pipelines module), so mandatory_fields and
--   gate config live inside each stage object; only the scope columns need DDL.
-- Rollback: ALTER TABLE crm.pipelines DROP COLUMN IF EXISTS product,
--           DROP COLUMN IF EXISTS region, DROP COLUMN IF EXISTS business_unit;
-- Affected services: crm-service (pipelines module)
-- Sequencing: additive nullable columns; existing pipelines keep NULL scope (= applies
--   to every product/region/BU) so nothing needs a backfill.

SET lock_timeout = '5s';

ALTER TABLE crm.pipelines
  ADD COLUMN IF NOT EXISTS product       varchar(120),
  ADD COLUMN IF NOT EXISTS region        varchar(120),
  ADD COLUMN IF NOT EXISTS business_unit varchar(120);

-- Scope lookup: "give me the pipeline for this product/region/BU" filters on these.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_pipelines_tenant_scope
  ON crm.pipelines (tenant_id, product, region, business_unit)
  WHERE status <> 'deleted';
