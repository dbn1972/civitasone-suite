-- ============================================================================
-- Purpose (G15 / spec §25.7 J6-3 "review-date terms"):
--   Periodic MoU review schedule. An MoU is not a fire-and-forget document —
--   §25.7 requires the agreement repository to hold a review date so the
--   parties reconvene on a cadence (typically quarterly for a government MoU).
--
--   Modelled as its own table rather than a single review_date column on the
--   contract because a review is recurring: each cycle has its own next date,
--   its own completion record and its own outcome. A scalar column could only
--   ever hold the current cycle and would lose the review history.
--
--   next_review_date is a date (calendar cadence, no time-of-day semantics);
--   last_reviewed_at is timestamptz because it records a real instant.
--
-- Rollback steps (manual, requires tech-lead approval per steering):
--   SET lock_timeout = '5s';
--   DROP TABLE IF EXISTS mou.review_schedules;
--   -- DROP SCHEMA IF EXISTS mou;  only after 0019 is also rolled back
--
-- Affected services: contract-service (owner).
--   notification-service consumes contract.mou.review_due to raise the notice;
--   workflow-service may open a review task. Neither reads this table.
-- ============================================================================

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS mou;

CREATE TABLE IF NOT EXISTS mou.review_schedules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid NOT NULL,
  contract_id       uuid NOT NULL,
  review_code       varchar(64) NOT NULL,
  cadence           varchar(16) NOT NULL
    CHECK (cadence IN ('monthly', 'quarterly', 'half_yearly', 'annual')),
  next_review_date  date NOT NULL,
  last_reviewed_at  timestamptz,
  reviewer_role     varchar(64) NOT NULL DEFAULT 'contract_admin',
  status            varchar(16) NOT NULL DEFAULT 'scheduled'
    CHECK (status IN ('scheduled', 'completed', 'cancelled')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid NOT NULL,
  updated_by        uuid NOT NULL,
  version           integer NOT NULL DEFAULT 1
);

-- Business key: one review_code per contract per tenant.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_review_schedules_code
  ON mou.review_schedules (tenant_id, contract_id, review_code);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_schedules_contract
  ON mou.review_schedules (tenant_id, contract_id);
-- Sweep index for the review-due scanner.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_review_schedules_due
  ON mou.review_schedules (tenant_id, status, next_review_date);

ALTER TABLE mou.review_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE mou.review_schedules FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'mou' AND tablename = 'review_schedules' AND policyname = 'tenant_isolation'
  ) THEN
    CREATE POLICY tenant_isolation ON mou.review_schedules
      USING (tenant_id::text = current_setting('app.tenant_id', true))
      WITH CHECK (tenant_id::text = current_setting('app.tenant_id', true));
  END IF;
END $$;
