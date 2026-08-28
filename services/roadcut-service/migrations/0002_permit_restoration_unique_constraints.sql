-- Purpose: Close a check-then-insert race on permit issuance and restoration
-- start. Both routes verify no duplicate exists via a SELECT before
-- publishing a create command (see #816), but that check and the consumer's
-- INSERT happen in two separate steps (route -> queue -> consumer) with
-- nothing holding a lock in between — two concurrent requests can both pass
-- the pre-check and both insert. For restoration specifically this means
-- the same deposit could be refunded twice under real concurrency, since
-- refund resolves the deposit through permit -> application per-restoration.
-- These indexes make the second of two racing inserts fail loudly with a
-- unique-violation instead of silently succeeding.
-- Rollback: DROP INDEX roadcut.roadcut_permits_application_active_unique;
--           DROP INDEX roadcut.roadcut_restorations_permit_unique;

SET lock_timeout = '5s';

-- At most one NON-CANCELLED permit per application. A cancelled permit
-- (issued in error, or the applicant needed to reschedule) must not block a
-- legitimate new permit being issued for the same approved application
-- afterward — a plain (non-partial) unique index would wrongly forbid that
-- re-issuance, so cancelled permits are excluded from the constraint.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS roadcut_permits_application_active_unique
  ON roadcut.roadcut_permits (application_id)
  WHERE status != 'cancelled';

-- At most one restoration record per permit. Restoration has no
-- cancellation concept in the current domain model (PERMIT_STATUSES does,
-- restoration quality/deposit-refund status don't), so a plain unique index
-- is appropriate — there is no legitimate re-do scenario to carve out yet.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS roadcut_restorations_permit_unique
  ON roadcut.roadcut_restorations (permit_id);
