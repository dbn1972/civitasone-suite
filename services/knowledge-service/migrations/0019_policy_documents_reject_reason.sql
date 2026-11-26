-- 0019_policy_documents_reject_reason.sql
-- B27 / GAP-KNOWLEDGE-POLICIES-DETAIL-04 (owner-approved 2026-11-26): persist the
-- reviewer rejection reason on the policy. Nullable, additive, idempotent.
-- Read-visibility (author + approver roles only) is enforced in the service
-- (policies/repo.ts toView); the column is cleared when the author resubmits.
SET lock_timeout = '5s';
ALTER TABLE knowledge.policy_documents
  ADD COLUMN IF NOT EXISTS reject_reason text;
COMMENT ON COLUMN knowledge.policy_documents.reject_reason IS 'Latest reviewer rejection reason (author + approver visibility enforced in policies/repo.ts toView); cleared on resubmit.';
