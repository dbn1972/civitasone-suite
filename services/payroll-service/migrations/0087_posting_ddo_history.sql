-- 0087_posting_ddo_history.sql
-- ST-M01-11 (SmartTransfer OS) — dated posting / DDO history in payroll-service.
--
-- Spec §4, §11; D-ST-13 (payroll scope, PROPOSED), D-ST-14 (mid-month DDO
-- split + city-class source, PROPOSED). This table STORES ONLY WHAT THE
-- `hrms.posting.changed` EVENT CARRIES: the effective-dated office move
-- (from/to office), station, state, HRA city class, the optional DDO (Drawing
-- & Disbursing Officer) reference, the effective date and the order number.
-- It performs NO pay computation, NO TA/DA, NO mid-month split and NO HRA
-- class derivation — those all depend on the still-PROPOSED D-ST-13/14 and are
-- deliberately out of scope (listed open in the PR body). The row is the raw,
-- auditable posting FACT a later payroll consequence (when D-ST-13/14 close)
-- can read as-of a date; it is intentionally inert otherwise.
--
-- Append-only, effective-dated history. One row per applied posting event
-- (keyed idempotently on the originating event id — see event_id UNIQUE),
-- so a redelivery of the same `hrms.posting.changed` event is a no-op insert.
-- The "as-of" read (routes.ts) returns the single row with the greatest
-- effective_from on/before the requested date for the employee.
--
-- Cross-service boundary (house rule 2 / CLAUDE.md §3.13): employee_id,
-- office ids and ddo are foreign *references by id only* to HRMS / Workforce
-- Core entities — NO cross-service FK and NO cross-service SQL. The payroll
-- service never reads an HRMS table; this history is populated solely from the
-- event payload the hrms applyPosting path emits.
--
-- FORCE ROW LEVEL SECURITY + a leading tenant_id index, per house rule 3 and
-- the fleet convention (mirrors statutory.statutory_config / migration 0038
-- and 0026_rls_full_tenant_isolation.sql exactly). No NO FORCE…FORCE wrap is
-- needed: this migration creates an empty table and seeds nothing, so there is
-- no DML under FORCE RLS to exempt.
--
-- Next free payroll migration number: 0086 is the highest on origin/main and
-- no open st/* branch adds a payroll migration (checked with git ls-tree on
-- origin/main and every origin/st/m01-* branch), so 0087 does not collide.
--
-- Rollback: DROP TABLE payroll.posting_history;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS payroll.posting_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL,
  employee_id     UUID NOT NULL,
  -- The office move the posting event carried (reference by id only).
  from_office_id  UUID NOT NULL,
  to_office_id    UUID NOT NULL,
  -- Station / state / HRA city class as carried on the event. city_class is a
  -- plain code the producer fills (X/Y/Z today); NO classification is derived
  -- here (D-ST-14 source is PROPOSED).
  station         VARCHAR(200) NOT NULL,
  state           VARCHAR(200) NOT NULL,
  city_class      VARCHAR(8) NOT NULL,
  -- Drawing & Disbursing Officer reference. NULLABLE: there is no DDO source
  -- in Workforce Core today (the contract field is optional, tolerant reader
  -- D-18); the column exists so the history is complete once a DDO source
  -- lands under D-ST-14, without a further migration.
  ddo             UUID,
  -- Effective-dated history: the date this posting takes effect.
  effective_from  DATE NOT NULL,
  order_number    VARCHAR(200) NOT NULL,
  -- Idempotency key: the id of the originating posting event. A redelivery of
  -- the same event hits this UNIQUE and the consumer's ON CONFLICT DO NOTHING,
  -- so no duplicate history row is ever written.
  event_id        UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by      UUID NOT NULL,
  CONSTRAINT ux_posting_history_event UNIQUE (tenant_id, event_id)
);

-- Leading tenant_id index (house rule 3 / tenant-index guard minimum bar). The
-- composite also serves the as-of read, which filters by (tenant_id,
-- employee_id) and orders by effective_from DESC.
CREATE INDEX IF NOT EXISTS idx_posting_history_tenant
  ON payroll.posting_history (tenant_id);
CREATE INDEX IF NOT EXISTS idx_posting_history_tenant_emp_eff
  ON payroll.posting_history (tenant_id, employee_id, effective_from DESC);

ALTER TABLE payroll.posting_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE payroll.posting_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_policy ON payroll.posting_history;
CREATE POLICY tenant_isolation_policy ON payroll.posting_history
  USING (tenant_id = payroll.current_tenant_id())
  WITH CHECK (tenant_id = payroll.current_tenant_id());
