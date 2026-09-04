-- Purpose: building_permits_application_id_key (added in migrations/0001_init.sql,
-- fix #3) is a PLAIN unique index on (application_id). That is too strict: a
-- cancelled permit (issued in error, or the applicant needed to reschedule)
-- must not permanently block a legitimate new permit being issued for the
-- same approved application afterward. permits/repo.ts's findByApplicationId
-- now excludes status = 'cancelled' from its app-level PERMIT_ALREADY_EXISTS
-- pre-check, but the app-level fix alone is not enough here (unlike
-- roadcut-service, where the DB index was already partial) -- the plain DB
-- index would still throw a raw unique-violation on the re-issuance INSERT.
-- This migration converts it to a partial unique index that mirrors the
-- app-level check exactly, matching
-- roadcut-service/migrations/0002_permit_restoration_unique_constraints.sql's
-- pattern.
-- Rollback: DROP INDEX building.building_permits_application_active_unique;
--           CREATE UNIQUE INDEX building_permits_application_id_key
--             ON building.building_permits (application_id);

SET lock_timeout = '5s';

DROP INDEX CONCURRENTLY IF EXISTS building.building_permits_application_id_key;

-- At most one NON-CANCELLED permit per application. 'expired' is
-- deliberately NOT excluded here: building-service DOES have a renewal
-- flow for expired permits (POST /v1/building/renewals; lifecycle/domain.ts's
-- canRequestRenewal() allows renewal from the 'expired' state). Keeping
-- 'expired' inside this constraint is intentional -- it forces a caller to
-- go through that renewal path rather than reissuing a brand-new permit
-- for the same application (see permits/repo.ts's findByApplicationId comment), so
-- reissuing a new permit outside that flow.
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS building_permits_application_active_unique
  ON building.building_permits (application_id)
  WHERE status != 'cancelled';
