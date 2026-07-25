-- Migration: 0023_vendor_performance.sql
-- Purpose: SVC-049 Vendor performance. Immutable performance-event ledger,
--          objective scorecard (delivery/quality/SLA -> rating band), and the
--          show-cause -> response -> appeal -> decision workflow.
-- Additive + idempotent. Safe to re-run.
-- Rollback: DROP TABLE IF EXISTS vendor.procurement_vendor_show_cause,
--           vendor.procurement_vendor_scorecards, vendor.procurement_vendor_performance_events;
-- Affected services: procurement-service (vendor module), consumes GRN + contract events
-- Requirements: SVC-049

BEGIN;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS vendor.procurement_vendor_performance_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL,
  vendor_id   UUID NOT NULL,
  event_type  VARCHAR(24) NOT NULL
                CHECK (event_type IN ('grn_accepted', 'grn_rejected', 'delivery_late', 'delivery_on_time', 'sla_breach')),
  source      VARCHAR(16) NOT NULL DEFAULT 'grn'
                CHECK (source IN ('grn', 'contract', 'manual')),
  source_ref  TEXT,
  po_ref      TEXT,
  weight      INTEGER NOT NULL DEFAULT 1,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by  UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_vperf_events_vendor
  ON vendor.procurement_vendor_performance_events (tenant_id, vendor_id);

CREATE TABLE IF NOT EXISTS vendor.procurement_vendor_scorecards (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL,
  vendor_id          UUID NOT NULL,
  period             VARCHAR(16) NOT NULL DEFAULT 'all',
  total_orders       INTEGER NOT NULL DEFAULT 0,
  on_time_deliveries INTEGER NOT NULL DEFAULT 0,
  late_deliveries    INTEGER NOT NULL DEFAULT 0,
  quality_rejections INTEGER NOT NULL DEFAULT 0,
  sla_breaches       INTEGER NOT NULL DEFAULT 0,
  delivery_score     INTEGER NOT NULL DEFAULT 0,
  quality_score      INTEGER NOT NULL DEFAULT 0,
  sla_score          INTEGER NOT NULL DEFAULT 0,
  overall_rating     INTEGER NOT NULL DEFAULT 0,
  rating_band        VARCHAR(8) NOT NULL DEFAULT 'unrated'
                       CHECK (rating_band IN ('A', 'B', 'C', 'D', 'unrated')),
  computed_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  version            INT NOT NULL DEFAULT 1,
  CONSTRAINT uq_vscorecard_vendor_period UNIQUE (tenant_id, vendor_id, period)
);

CREATE TABLE IF NOT EXISTS vendor.procurement_vendor_show_cause (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL,
  vendor_id    UUID NOT NULL,
  reason       TEXT NOT NULL,
  status       VARCHAR(16) NOT NULL DEFAULT 'issued'
                 CHECK (status IN ('issued', 'responded', 'appealed', 'upheld', 'closed')),
  issued_by    UUID NOT NULL,
  response     TEXT,
  responded_at TIMESTAMPTZ,
  appeal_text  TEXT,
  appealed_at  TIMESTAMPTZ,
  decided_by   UUID,
  decision     TEXT,
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by   UUID NOT NULL,
  updated_by   UUID NOT NULL,
  version      INT NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_vshowcause_vendor
  ON vendor.procurement_vendor_show_cause (tenant_id, vendor_id);

-- RLS: fail-closed tenant isolation (indent.current_tenant_id()).
ALTER TABLE vendor.procurement_vendor_performance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendor_performance_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendor_performance_events;
CREATE POLICY tenant_isolation ON vendor.procurement_vendor_performance_events
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

ALTER TABLE vendor.procurement_vendor_scorecards ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendor_scorecards FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendor_scorecards;
CREATE POLICY tenant_isolation ON vendor.procurement_vendor_scorecards
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

ALTER TABLE vendor.procurement_vendor_show_cause ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor.procurement_vendor_show_cause FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON vendor.procurement_vendor_show_cause;
CREATE POLICY tenant_isolation ON vendor.procurement_vendor_show_cause
  USING (tenant_id = indent.current_tenant_id())
  WITH CHECK (tenant_id = indent.current_tenant_id());

COMMIT;
