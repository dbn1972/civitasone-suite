-- 0035_three_way_match_invoice_ref.sql
--
-- DOM-027: POST /v1/procurement/three-way-match accepted a bare invoiceId +
-- client-asserted invoiceAmountMinor with zero paper trail -- unlike the
-- separate POST /v1/procurement/matches/invoice, which has always required a
-- structured invoiceRef (but, until this same change, never forwarded it
-- past validation either -- accepted, then silently discarded). Both
-- endpoints now REQUIRE invoiceRef whenever invoice info is supplied (see
-- src/modules/three-way-match/routes.ts) and thread it through to the
-- consumer/repo, so this column gives it somewhere real to persist to.
-- Nullable: historical rows predate this column, and a PO+GRN-only match
-- (no invoice attached yet) never carries one. Mirrors 0031's shape exactly
-- (same table, same ADD COLUMN IF NOT EXISTS pattern).
SET lock_timeout = '5s';

ALTER TABLE procurement.three_way_match
  ADD COLUMN IF NOT EXISTS invoice_ref VARCHAR(128);
