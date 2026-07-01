-- 0005: Expand edition enum to cover all Indian organisation types.
-- Old: small_office | psu | govt (only 3)
-- New: govt | psu | private | ngo | section8 | cooperative | small_office
-- Also adds org_category for broader classification.
-- Additive, forward-only.

-- Drop the old CHECK constraint (if any) and widen the column.
-- The edition column is varchar(32) so it already fits. We just need to
-- update the application-level enum (validators.ts) — no DB constraint exists.
-- However, adding an org_category column provides richer classification.

ALTER TABLE tenant.tenants
  ADD COLUMN IF NOT EXISTS org_category TEXT;

COMMENT ON COLUMN tenant.tenants.org_category IS
  'Organisation category for richer classification:
   central_govt, state_govt, local_body, statutory_body, autonomous_body,
   central_psu, state_psu, private_ltd, public_ltd, llp,
   society, trust, section8, cooperative, proprietorship, partnership';

COMMENT ON COLUMN tenant.tenants.edition IS
  'Product edition (controls features/entitlements):
   govt — Government department (Central/State/Local/Statutory/Autonomous)
   psu — Public Sector Undertaking (Central PSU, State PSU)
   private — Private company (Pvt Ltd, Ltd, LLP)
   ngo — Non-Governmental Organisation (Society, Trust)
   section8 — Section 8 Company (non-profit corporate)
   cooperative — Cooperative society
   small_office — Small office / micro enterprise (2-50 users)';
