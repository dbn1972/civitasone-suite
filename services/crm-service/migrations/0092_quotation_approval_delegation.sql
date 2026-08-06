-- ═══════════════════════════════════════════════════════════════════════════════
-- Purpose: G26 — record WHICH delegation limit drove a quotation approval decision.
--
--   crm.quotation_approvals already holds the request/decision ledger (migration 0062).
--   G26 makes the routing decision come from crm.delegation_limits, so the row must say
--   which limit was applied and who it was escalated to. Without that, a later audit can
--   see that an approval was required but not by whose authority — and because the limits
--   are effective-dated, the answer cannot be recomputed after the card changes.
--
--   applied_limit_id           the delegation limit that was in force and applied.
--   applied_limit_bps          its max_discount_bps, SNAPSHOT at decision time. Denormalised
--                              on purpose: the limit row may later be superseded, and the
--                              audit question is "what was the authority then", which a
--                              join to the live row cannot answer.
--   required_approver_role     the role the request was escalated to (NULL when the
--                              requester's own authority covered it).
--   required_approver_level    that role's level in the escalation chain.
--   authority_outcome          which branch of the resolution fired, so an operator can
--                              distinguish "escalated to a named approver" from
--                              "beyond anyone's delegation" from "no policy configured".
--
-- All five columns are ADDED NULLABLE with no backfill. Existing rows predate G26 and
-- legitimately have no applied limit; forcing a value would invent an authority that was
-- never exercised. No existing column is altered, renamed or dropped.
--
-- Rollback:
--   SET lock_timeout = '5s';
--   ALTER TABLE crm.quotation_approvals
--     DROP COLUMN IF EXISTS applied_limit_id,
--     DROP COLUMN IF EXISTS applied_limit_bps,
--     DROP COLUMN IF EXISTS required_approver_role,
--     DROP COLUMN IF EXISTS required_approver_level,
--     DROP COLUMN IF EXISTS authority_outcome;
--   DROP INDEX IF EXISTS crm.idx_quotation_approvals_applied_limit;
--   (drops only columns this migration added; the pre-G26 ledger is untouched.)
--
-- Affected services: crm-service (deals/quotation-approval + discounts modules).
-- ═══════════════════════════════════════════════════════════════════════════════

SET lock_timeout = '5s';

ALTER TABLE crm.quotation_approvals
  ADD COLUMN IF NOT EXISTS applied_limit_id uuid,
  ADD COLUMN IF NOT EXISTS applied_limit_bps integer,
  ADD COLUMN IF NOT EXISTS required_approver_role varchar(64),
  ADD COLUMN IF NOT EXISTS required_approver_level integer,
  ADD COLUMN IF NOT EXISTS authority_outcome varchar(24);

DO $c$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotation_approvals_authority_outcome_check'
      AND conrelid = 'crm.quotation_approvals'::regclass
  ) THEN
    -- NOT VALID: the constraint governs new writes without scanning the existing ledger,
    -- which is what keeps this migration lock-cheap. Pre-G26 rows are all NULL here and
    -- would pass anyway, but not scanning them is the point.
    ALTER TABLE crm.quotation_approvals
      ADD CONSTRAINT quotation_approvals_authority_outcome_check
      CHECK (authority_outcome IS NULL OR authority_outcome IN
        ('auto_approved','approval_required','beyond_delegation','no_policy')) NOT VALID;
  END IF;
END $c$;

DO $b$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quotation_approvals_applied_limit_bps_check'
      AND conrelid = 'crm.quotation_approvals'::regclass
  ) THEN
    ALTER TABLE crm.quotation_approvals
      ADD CONSTRAINT quotation_approvals_applied_limit_bps_check
      CHECK (applied_limit_bps IS NULL OR applied_limit_bps BETWEEN 0 AND 10000) NOT VALID;
  END IF;
END $b$;

-- "Which approvals did this limit authorise?" is the audit query this supports.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotation_approvals_applied_limit
  ON crm.quotation_approvals (tenant_id, applied_limit_id)
  WHERE applied_limit_id IS NOT NULL;
