-- 0036_three_way_match_invoice_date.sql
--
-- DOM-032: POST /v1/procurement/matches/invoice's optional invoiceDate field
-- was accepted and validated but never referenced anywhere in the handler
-- body -- never forwarded into commands.runThreeWayMatch(), and had no
-- column to land in even if it were. Same discard shape invoiceRef had on
-- this same endpoint before DOM-027 (migration 0035) fixed it. invoiceDate
-- stays optional here (unlike invoiceRef, there is no requirement that it
-- accompany invoice info) -- this column just gives it somewhere real to
-- persist to instead of being silently dropped.
--
-- Stored as VARCHAR, not DATE: invoiceAttachBody's Zod schema for this field
-- is z.string().optional() with no format constraint, so a DATE column would
-- trade a clean 400 at the HTTP boundary for a runtime SQL cast failure on a
-- malformed value -- tightening that validation is a separate, un-asked-for
-- change, not this gap's DoD (see routes.ts/schema.ts for the same note).
--
-- Nullable: historical rows predate this column, and it is optional on its
-- one caller. Mirrors 0035's shape exactly (same table, same
-- ADD COLUMN IF NOT EXISTS pattern).
SET lock_timeout = '5s';

ALTER TABLE procurement.three_way_match
  ADD COLUMN IF NOT EXISTS invoice_date VARCHAR(32);
