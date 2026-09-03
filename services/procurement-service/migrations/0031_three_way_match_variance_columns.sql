-- 0031_three_way_match_variance_columns.sql
--
-- BUG: src/modules/three-way-match/schema.ts (the Drizzle model every read
-- path in this module uses — repo.listByTenant / findLatestForPoGrn /
-- findMatchById all do a bare tx.select().from(threeWayMatch), which SELECTs
-- every column the schema declares) has always declared variance_pct and
-- auto_matched columns that migration 0006_world_class.sql never created on
-- procurement.three_way_match (it created tolerance_pct instead — the
-- configured threshold — not variance_pct, the computed per-match value).
-- Every GET /v1/procurement/three-way-match* request has therefore always
-- 500'd with column "variance_pct" does not exist (tests/routes-coverage-full.test.ts,
-- three-way-match GET routes).
--
-- The write path (repo.upsertDerivedMatch) uses a hand-written INSERT that
-- only names real columns, so it never hit this — and the consumer
-- (src/modules/three-way-match/consumer.ts) already computes variancePct
-- per match but had nowhere to persist it (it only forwarded the value on
-- the procurement.three_way_match.completed outbox event). This migration
-- adds the two missing columns; a follow-up code change (this same commit)
-- makes upsertDerivedMatch persist them instead of silently dropping them.
SET lock_timeout = '5s';

ALTER TABLE procurement.three_way_match
  ADD COLUMN IF NOT EXISTS variance_pct NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS auto_matched BOOLEAN NOT NULL DEFAULT false;
