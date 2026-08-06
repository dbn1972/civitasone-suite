-- ============================================================================
-- Purpose (G15 / spec §25.7 J6-3):
--   First-class penalty / SLA terms for contracts and MoUs, plus an append-only
--   ledger of penalty applications.
--
--   Until now the only penalty configuration lived inside the untyped
--   contracts.contract_contracts.sla_terms jsonb blob, read defensively in the
--   consumer with hard-coded fallbacks (0.5 %/week, 10 % cap). That is not a
--   queryable, auditable, per-trigger term set. mou.penalty_terms makes each
--   term a row with an explicit trigger, threshold and penalty representation.
--
--   MONEY PRECISION — why these columns and not a numeric percentage:
--     * penalty_amount_minor bigint  — used by kind 'fixed' and 'per_day'.
--       Minor units (paise) only. bigint holds ±9.22e18 paise, far beyond the
--       2^53 limit of an IEEE-754 double, so no value is ever representable
--       only approximately.
--     * penalty_rate_bps integer     — used by kind 'percentage'.
--       Basis points (1 bp = 0.01 %), an EXACT integer. The computation is
--       amountMinor * BigInt(bps) / 10000n — integer BigInt arithmetic end to
--       end, truncating toward zero. Storing "0.5 %" as a float/numeric and
--       multiplying money by it would reintroduce binary-fraction error and
--       force a Number cast; basis points make that impossible by construction.
--     A CHECK constraint guarantees exactly the column appropriate to the kind
--     is populated, so a term can never be half-specified.
--
--   DOUBLE-COUNT GUARD — mou.penalty_applications carries a UNIQUE constraint
--   on (tenant_id, penalty_term_id, occurrence_key). occurrence_key is derived
--   deterministically from the occurrence being penalised (e.g.
--   'milestone:<uuid>'), so a redelivered command, a retried consumer or a
--   duplicate operator action collides in the database rather than debiting
--   the vendor twice. This is a database-level constraint, not an application
--   check.
--
-- Rollback steps (manual, requires tech-lead approval per steering):
--   SET lock_timeout = '5s';
--   DROP TABLE IF EXISTS mou.penalty_applications;
--   DROP TABLE IF EXISTS mou.penalty_terms;
--   DROP SCHEMA IF EXISTS mou;   -- only if 0020 has also been rolled back
--
-- Affected services: contract-service (owner).
--   finance-service consumes contract.penalty.applied to raise a recovery /
--   deduction; notification-service consumes it for the vendor notice. Neither
--   reads these tables directly (cross-service reads go over HTTP).
-- ============================================================================

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS mou;

-- ── Penalty / SLA terms ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mou.penalty_terms (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  contract_id           uuid NOT NULL,
  term_code             varchar(64) NOT NULL,
  description           text NOT NULL DEFAULT '',
  trigger_type          varchar(32) NOT NULL
    CHECK (trigger_type IN ('milestone_missed', 'sla_breached')),
  -- Grace allowance before the trigger bites. Days for milestone_missed,
  -- breach count for sla_breached. Integer: never fractional, never money.
  threshold_value       integer NOT NULL DEFAULT 0 CHECK (threshold_value >= 0),
  penalty_kind          varchar(16) NOT NULL
    CHECK (penalty_kind IN ('fixed', 'percentage', 'per_day')),
  -- Money in minor units (paise). Populated for 'fixed' (one-off charge) and
  -- 'per_day' (charge per day of delay).
  penalty_amount_minor  bigint CHECK (penalty_amount_minor IS NULL OR penalty_amount_minor >= 0),
  -- Basis points (1 bp = 0.01 %). Populated for 'percentage'. 10000 bp = 100 %.
  penalty_rate_bps      integer CHECK (penalty_rate_bps IS NULL OR (penalty_rate_bps >= 0 AND penalty_rate_bps <= 10000)),
  -- Cap on the total penalty as basis points of the milestone amount.
  max_penalty_bps       integer NOT NULL DEFAULT 10000
    CHECK (max_penalty_bps >= 0 AND max_penalty_bps <= 10000),
  currency              char(3) NOT NULL DEFAULT 'INR',
  active                boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1,
  -- Exactly the representation matching the kind must be present. A
  -- 'percentage' term with a bigint amount, or a 'fixed' term with only a
  -- rate, is rejected by the database.
  CONSTRAINT penalty_terms_representation_check CHECK (
    (penalty_kind = 'percentage' AND penalty_rate_bps IS NOT NULL AND penalty_amount_minor IS NULL)
    OR (penalty_kind IN ('fixed', 'per_day') AND penalty_amount_minor IS NOT NULL AND penalty_rate_bps IS NULL)
  )
);

-- Business key: one term_code per contract per tenant.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_penalty_terms_code
  ON mou.penalty_terms (tenant_id, contract_id, term_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_terms_tenant_contract
  ON mou.penalty_terms (tenant_id, contract_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_terms_trigger
  ON mou.penalty_terms (tenant_id, trigger_type, active);

ALTER TABLE mou.penalty_terms ENABLE ROW LEVEL SECURITY;
ALTER TABLE mou.penalty_terms FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mou' AND tablename = 'penalty_terms' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON mou.penalty_terms
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;

-- ── Penalty applications ledger (append-only) ───────────────────────────────
CREATE TABLE IF NOT EXISTS mou.penalty_applications (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             uuid NOT NULL,
  contract_id           uuid NOT NULL,
  penalty_term_id       uuid NOT NULL REFERENCES mou.penalty_terms(id),
  -- NULL when the trigger was an SLA breach not tied to one milestone.
  milestone_id          uuid,
  -- Deterministic identity of the penalised occurrence, e.g.
  -- 'milestone:<uuid>' or 'sla:<period-code>'. Together with
  -- (tenant_id, penalty_term_id) this is the double-count business key.
  occurrence_key        text NOT NULL,
  -- Exact money, minor units. bigint so amounts above 2^53 stay exact.
  computed_amount_minor bigint NOT NULL CHECK (computed_amount_minor >= 0),
  currency              char(3) NOT NULL DEFAULT 'INR',
  -- Inputs the amount was derived from, for audit reconstruction. Not money
  -- arithmetic input: purely explanatory.
  basis                 jsonb,
  applied_at            timestamptz NOT NULL DEFAULT now(),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  created_by            uuid NOT NULL,
  updated_by            uuid NOT NULL,
  version               integer NOT NULL DEFAULT 1
);

-- THE double-spend guard. Database-level, not an application check.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_penalty_applications_occurrence
  ON mou.penalty_applications (tenant_id, penalty_term_id, occurrence_key);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_applications_contract
  ON mou.penalty_applications (tenant_id, contract_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_penalty_applications_milestone
  ON mou.penalty_applications (tenant_id, milestone_id);

ALTER TABLE mou.penalty_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE mou.penalty_applications FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mou' AND tablename = 'penalty_applications' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON mou.penalty_applications
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
