-- Purpose: adv_permits has NO unique or FK constraint on application_id at
-- all (confirmed against migrations/0001_initial.sql, 0002_enforcement_schema.sql,
-- 0003_number_sequences.sql). The only protection against a permit being
-- issued more than once for the same application was permits/repo.ts's
-- findByApplication pre-check in routes.ts's POST /v1/advertisement/permits
-- handler -- a check-then-insert race with nothing holding a lock in
-- between, exactly the class of gap roadcut-service's
-- migrations/0002_permit_restoration_unique_constraints.sql closed (see
-- #816 there). This migration adds the missing DB-level backstop, as a
-- partial unique index so it agrees with findByApplication's app-level
-- check exactly.
--
-- Both 'cancelled' and 'expired' are excluded, not just 'cancelled':
-- domain.ts's canRenew() explicitly treats them the same way -- neither can
-- go through POST /v1/advertisement/permits/:id/renew. Since renewal is
-- unavailable for both, the only way forward for either is a fresh permit
-- issuance under the same application, so neither may block it.
-- Rollback: DROP INDEX adv_permits.adv_permits_application_active_unique;

SET lock_timeout = '5s';

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS adv_permits_application_active_unique
  ON adv_permits.adv_permits (application_id)
  WHERE status NOT IN ('cancelled', 'expired');
