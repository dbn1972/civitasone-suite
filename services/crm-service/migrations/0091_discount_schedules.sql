-- ═══════════════════════════════════════════════════════════════════════════════
-- Purpose: G26 — slab-based discount schedules and delegation-of-authority limits.
--
--   crm.discount_schedules  an effective-dated rate card attached to ONE scope (a
--                           product or a price book). `basis` says whether its slabs
--                           are measured in units (volume) or in minor units (value).
--   crm.discount_slabs      the slabs of a schedule. Half-open interval
--                           [from_threshold, to_threshold) with to_threshold NULL =
--                           unbounded, so contiguous slabs need neither a gap nor an
--                           overlap. discount_bps is an INTEGER number of basis points
--                           (1 bps = 0.01%); a percentage held as a float drifts against
--                           the contract value it is derived from.
--   crm.delegation_limits    the maximum discount (bps) a role may grant without
--                           escalating, also effective-dated. `level` orders the
--                           escalation chain (higher = more senior) and is deliberately
--                           separate from the limit so escalation is by seniority, not
--                           by whoever happens to hold a bigger number.
--
-- Effective dating: effective_to is INCLUSIVE (the last day the row applies) and NULL
--   means open-ended. Rows are never mutated in place to change a rate; a new row is
--   opened and the old one closed, so a quotation approved last quarter keeps resolving
--   against the card that was in force when it was approved.
--
-- Money/thresholds: bigint minor units, never numeric/float. Thresholds are bigint on
--   both bases so a value slab can exceed 2^53.
--
-- Rollback:
--   DROP TABLE IF EXISTS crm.discount_slabs;
--   DROP TABLE IF EXISTS crm.discount_schedules;
--   DROP TABLE IF EXISTS crm.delegation_limits;
--   (all three are new in this migration; nothing pre-existing is altered, so the
--    rollback is a pure drop with no data reconstruction.)
--
-- Affected services: crm-service (discounts module; read by the deals/quotation
--   approval path).
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.discount_schedules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  name           varchar(200) NOT NULL,
  -- What the card hangs off. Product-agnostic: no service/lane/tariff concept here.
  scope_type     varchar(16) NOT NULL CHECK (scope_type IN ('product','price_book')),
  scope_id       uuid NOT NULL,
  -- 'volume' => slab thresholds are quantities; 'value' => minor units.
  basis          varchar(8) NOT NULL CHECK (basis IN ('volume','value')),
  currency       char(3) NOT NULL DEFAULT 'INR',
  effective_from date NOT NULL,
  effective_to   date,
  enabled        boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT discount_schedules_window_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- Business key: one schedule per scope+basis+currency STARTING on a given day. A second
-- card for the same day is an operator double-submit, not a new rate, and the consumer
-- reads the empty RETURNING to treat it as a duplicate.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_discount_schedules_scope_from
  ON crm.discount_schedules (tenant_id, scope_type, scope_id, basis, currency, effective_from);

-- Resolution path: the card in force for a scope as at a date.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discount_schedules_resolve
  ON crm.discount_schedules (tenant_id, scope_type, scope_id, effective_from DESC)
  WHERE enabled = true;

CREATE TABLE IF NOT EXISTS crm.discount_slabs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL,
  schedule_id    uuid NOT NULL REFERENCES crm.discount_schedules (id),
  -- Half-open [from_threshold, to_threshold); to_threshold NULL = unbounded above.
  from_threshold bigint NOT NULL CHECK (from_threshold >= 0),
  to_threshold   bigint,
  -- Basis points, integer, 0..10000. NEVER a percentage as numeric/float.
  discount_bps   integer NOT NULL CHECK (discount_bps BETWEEN 0 AND 10000),
  ordinal        integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  created_by     uuid NOT NULL,
  updated_by     uuid NOT NULL,
  version        integer NOT NULL DEFAULT 1,
  CONSTRAINT discount_slabs_bounds_check
    CHECK (to_threshold IS NULL OR to_threshold > from_threshold)
);

-- Two slabs cannot start at the same threshold. Full overlap rejection needs range
-- containment and is enforced in the domain (validateSlabs) at the route boundary, which
-- can also explain WHICH pair overlaps; this index stops the exact-duplicate case at the
-- database so a concurrent double-write cannot slip one past that check.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_discount_slabs_schedule_from
  ON crm.discount_slabs (tenant_id, schedule_id, from_threshold);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_discount_slabs_schedule
  ON crm.discount_slabs (tenant_id, schedule_id, from_threshold);

CREATE TABLE IF NOT EXISTS crm.delegation_limits (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  role             varchar(64) NOT NULL,
  -- Escalation ordering; higher is more senior. An approver must outrank the requester.
  level            integer NOT NULL DEFAULT 0 CHECK (level >= 0),
  max_discount_bps integer NOT NULL CHECK (max_discount_bps BETWEEN 0 AND 10000),
  effective_from   date NOT NULL,
  effective_to     date,
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1,
  CONSTRAINT delegation_limits_window_check
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

-- One limit per role STARTING on a given day; re-issuing the same day's limit updates it
-- rather than leaving two rows whose precedence would depend on row order.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_delegation_limits_role_from
  ON crm.delegation_limits (tenant_id, role, effective_from);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_delegation_limits_resolve
  ON crm.delegation_limits (tenant_id, level, effective_from DESC)
  WHERE enabled = true;

-- RLS tenant isolation, matching crm.price_books / crm.approval_thresholds.
DO $iso$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['discount_schedules','discount_slabs','delegation_limits'] LOOP
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
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.discount_schedules TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.discount_slabs TO crm_svc;
    GRANT SELECT, INSERT, UPDATE, DELETE ON crm.delegation_limits TO crm_svc;
  END IF;
END $g$;
