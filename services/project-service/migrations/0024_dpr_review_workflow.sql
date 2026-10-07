-- GAP-PROJECTS-DPR-TRACKING-01: DPR review workflow (submit → review → approve
--   | return-for-revision), enforced + audited server-side.
--
-- The DPR row (progress.project_dprs) already carries a `status` with a CHECK
-- constraint of ('submitted','under_review','approved','revision') and a
-- `submitted_by`/`submitted_at`. What it lacked was a REVIEW trail: who moved
-- it to under_review/approved/revision, when, and (for a return) why. This
-- migration adds the three review-trail columns the transition consumer writes.
-- The status CHECK already permits every target state the transition command
-- uses, so no constraint change is needed (verified against the live
-- progress.project_dprs definition).
--
-- Additive and idempotent (ADD COLUMN IF NOT EXISTS). All three columns are
-- nullable with no DEFAULT: a DPR that predates this migration has not been
-- reviewed, so NULL ("not yet reviewed") is the correct value for every
-- existing row — this migration must not invent a reviewer or a timestamp.
--
-- Rollback: ALTER TABLE progress.project_dprs
--   DROP COLUMN IF EXISTS reviewed_by,
--   DROP COLUMN IF EXISTS reviewed_at,
--   DROP COLUMN IF EXISTS review_reason;
-- Affected services: project-service (progress module)

SET lock_timeout = '5s';

ALTER TABLE progress.project_dprs
  ADD COLUMN IF NOT EXISTS reviewed_by    uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS review_reason  text;

-- No new grants: progress.project_dprs is already owned by project_svc and
-- SELECT-granted to project_scanner by migration 0019's ALTER DEFAULT
-- PRIVILEGES (new columns on an existing granted table inherit the table
-- grant). RLS (tenant_isolation_policy) already covers every column.
