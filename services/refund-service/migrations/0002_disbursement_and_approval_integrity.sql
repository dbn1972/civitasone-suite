-- Purpose: DB-level backstops for two TOCTOU races found during deep
-- verification, closing both regardless of the application-layer guards in
-- reconciliation/routes.ts + consumer.ts and processing/routes.ts + consumer.ts:
--
--   1. A refund request must never have more than one ACTIVE (non-failed)
--      disbursement at a time -- two would mean money moving twice for the
--      same refund. A request MAY accumulate multiple "failed" disbursement
--      rows over time (retries after e.g. a bad IFSC code), so this is a
--      PARTIAL unique index, not a plain one.
--
--   2. A refund request must never have more than one CURRENT "approved"
--      decision at a given approval level -- two would mean the same
--      maker-checker level was exercised twice for one decision. A request
--      MAY have had an "approved" row at a given level in an EARLIER review
--      round that was superseded by a later return-for-correction (see
--      processing/repo.ts's supersedeApprovals, which flips those rows'
--      decision away from "approved"), so this is also a PARTIAL index,
--      scoped to decision = 'approved' only.
--
-- Depends on: services/refund-service/migrations/0001_initial.sql (PR #777,
-- not yet merged to main as of this migration -- see that PR / the
-- fix/refund-deep-verify PR description for status). This file assumes
-- 0001 has already created the refund.refund_disbursements and
-- refund.refund_approvals tables; run it after 0001, not standalone.
--
-- Already applied by hand to the live dev DB during verification (both
-- indexes below, plus the equivalent of #1 before this file existed) --
-- this migration captures that live change in version control so a fresh
-- environment or DR restore gets the same protection instead of a silent
-- gap. Safe to re-run: both statements are idempotent (`IF NOT EXISTS`).
--
-- Rollback:
--   DROP INDEX IF EXISTS refund.refund_disbursements_one_active_per_request;
--   DROP INDEX IF EXISTS refund.refund_approvals_one_current_per_level;

SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS refund_disbursements_one_active_per_request
  ON refund.refund_disbursements (tenant_id, request_id)
  WHERE status <> 'failed';

CREATE UNIQUE INDEX IF NOT EXISTS refund_approvals_one_current_per_level
  ON refund.refund_approvals (tenant_id, request_id, approval_level)
  WHERE decision = 'approved';
