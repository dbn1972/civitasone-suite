-- P0-01: schema-vs-DB drift fix. grant-service Drizzle schema (scheme/schema.ts:20)
-- declares reporting_frequency_days but 0001_init.sql never created it, causing
-- "column reporting_frequency_days does not exist" (42703) on every scheme read.
ALTER TABLE scheme.grant_schemes
  ADD COLUMN IF NOT EXISTS reporting_frequency_days integer DEFAULT 90;
