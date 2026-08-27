-- Purpose: enforce at most one permit per application at the database level.
-- Found during the shop-service deep-verification pass: issuePermit's
-- consumer had no application-scoped uniqueness guard at all — only
-- permit_number and verification_code were unique (see 0001_initial.sql).
-- Two concurrent or retried issue commands for the same approved
-- application could both pass the route's (snapshot-in-time) precondition
-- check and both insert a permit, producing two independently-suspendable
-- "active" licences for one approval. The application-layer pre-check added
-- alongside this migration narrows that race but is not atomic on its own;
-- this index is the actual backstop (the consumer catches the resulting
-- 23505 unique-violation and treats it as a benign no-op rather than an
-- unhandled error).
--
-- This is additive — it does not modify 0001_initial.sql (owned by the
-- separate municipal-batch2-db-infra migration PR) and does not conflict
-- with it.
--
-- Rollback: DROP INDEX shop.shop_permits_application_id_key;
SET lock_timeout = '5s';

CREATE UNIQUE INDEX IF NOT EXISTS shop_permits_application_id_key
  ON shop.permits (application_id);
