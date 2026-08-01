-- Purpose: CR-AI-03 — structured rejection feedback. Adds a machine-readable reason_code
--          plus free-text reason_text alongside the existing free-text `reason` column so
--          rejections can be aggregated (GET /v1/recommendations/feedback/rejection-summary).
-- Rollback: ALTER TABLE recommendation.recommendation_feedback
--             DROP COLUMN IF EXISTS reason_code, DROP COLUMN IF EXISTS reason_text;
--           (destructive — requires approval)
-- Affected services: recommendation-service only
SET lock_timeout = '5s';

-- Additive and nullable on purpose: recommendation_feedback already holds rows
-- written before reason codes existed, so NOT NULL here would fail. The
-- "mandatory when reasonCode = 'other'" rule is enforced at the route boundary
-- (feedback/reason-domain.ts) rather than by a constraint, because it applies to
-- new writes only and must return a 400 with code REASON_REQUIRED.
ALTER TABLE recommendation.recommendation_feedback
  ADD COLUMN IF NOT EXISTS reason_code varchar(32);

ALTER TABLE recommendation.recommendation_feedback
  ADD COLUMN IF NOT EXISTS reason_text text;

-- Serves the rejection-summary aggregate. Partial index: only rejections carry a
-- reason code, so indexing the NULLs would be dead weight.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_recommendation_feedback_tenant_reason_code
  ON recommendation.recommendation_feedback (tenant_id, reason_code)
  WHERE reason_code IS NOT NULL;

-- No CHECK constraint on reason_code: legacy rows are NULL and a future reason
-- code must not require a table rewrite. The allowed set is the single source of
-- truth in feedback/reason-domain.ts (REJECTION_REASON_CODES) and is validated
-- by zod at the route boundary before any write.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'recommendation_svc') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON recommendation.recommendation_feedback TO recommendation_svc;
  END IF;
END $$;
