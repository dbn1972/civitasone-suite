-- 0048_fix_fnf_exemption_ceilings_10x.sql
--
-- CRITICAL fix: all four F&F settlement exemption ceilings seeded by
-- migration 0022 are exactly 10x their own documented rupee figure, so real
-- Full & Final settlements have been treating far more of a payout as
-- tax-exempt than the Income-tax Act allows -- i.e. under-withholding TDS
-- on separation.
--
-- Evidence -- each row's seeded ceiling_minor vs. what 0022's OWN "notes"
-- column says it is (₹1L = ₹1,00,000; paise = rupees × 100):
--   section   0022's notes         seeded (paise)   documented×100   10x?
--   10_10     "Gratuity ₹20L"        2,000,000,000     200,000,000    yes
--   10_10AA   "Leave enc. ₹25L"      2,500,000,000     250,000,000    yes
--   10_10B    "Retrenchment ₹5L"       500,000,000      50,000,000    yes
--   10_10C    "VRS ₹5L"                500,000,000      50,000,000    yes
-- Same pattern, same 10x factor, on both the FY2024-25 and FY2025-26 rows
-- (8 rows total).
--
-- Impact: fnf/domain.ts's Sec 10(10)/10(10AA)/10(10B)/10(10C) exemption
-- functions (tax/exemptions.ts) all compute
-- exempt = LEAST(actual, ceiling, statutory formula). With the ceiling 10x
-- too high it stops binding for any realistic settlement, so exempt
-- silently collapses to LEAST(actual, formula) -- dropping the one limb the
-- Act actually meant to cap. A settlement whose formula/actual amount falls
-- between the correct and the wrong ceiling is fully exempted instead of
-- capped, understating total_taxable_minor and tds_on_separation_minor on
-- the persisted payroll.fnf_settlements row.
--
-- The identical wrong constants are also hardcoded as the no-config-row
-- fallback in services/payroll-service/src/modules/fnf/routes.ts and
-- fnf/consumer.ts (`ceilingMap.get(...) ?? 2000000000n` etc.) -- corrected
-- in the same PR as this migration (a migration cannot change TS source).
-- No FY2026-27 row existed before this migration, and FY2026-27 is the
-- current fiscal year, so every real settlement computed today was hitting
-- those equally-wrong fallbacks on every request.
--
-- Fix, two parts:
--  1) Correct the 8 existing FY2024-25/FY2025-26 rows IN PLACE (UPDATE, not
--     DELETE+INSERT, to preserve id/created_at/audit history). Guarded on
--     the exact wrong value, so this is safe to re-run and will never touch
--     a row a payroll_admin has since legitimately edited to some OTHER
--     value via PUT /v1/payroll/tax/exemption-ceilings.
--  2) Seed FY2026-27 with the corrected values. No Finance Act amendment to
--     any of these four ceilings is on record since the AY 2024-25 leave-
--     encashment revision 0022's own notes already capture, so this carries
--     the same figures forward as current law -- the same convention
--     migration 0012 used for tax_config's FY2026-27 slab rows ("carries
--     forward the 2025-26 structure as current law"). ON CONFLICT DO
--     NOTHING, matching 0022's own seeding style, so this can never clobber
--     a row already present for FY2026-27 -- whether a real payroll_admin
--     amendment, or (as found live in the shared dev DB while verifying
--     this fix) unrelated leftover manual-test data. Reconciling any such
--     stray dev-only row is a separate, deliberate business-data action via
--     the existing PUT /v1/payroll/tax/exemption-ceilings endpoint (full
--     audit trail + emitted event), not something this bug-fix migration
--     should do silently.
--
-- Rollback:
--   UPDATE payroll.exemption_ceilings SET ceiling_minor = 2000000000 WHERE fy_start_year IN (2024,2025) AND section = '10_10';
--   UPDATE payroll.exemption_ceilings SET ceiling_minor = 2500000000 WHERE fy_start_year IN (2024,2025) AND section = '10_10AA';
--   UPDATE payroll.exemption_ceilings SET ceiling_minor = 500000000  WHERE fy_start_year IN (2024,2025) AND section IN ('10_10B','10_10C');
--   DELETE FROM payroll.exemption_ceilings WHERE fy_start_year = 2026 AND section IN ('10_10','10_10AA','10_10B','10_10C') AND notes LIKE '%corrected 10x seed%';

SET lock_timeout = '5s';

-- ---- 1) Correct the FY2024-25 / FY2025-26 rows in place -------------------
UPDATE payroll.exemption_ceilings
  SET ceiling_minor = 200000000
  WHERE fy_start_year IN (2024, 2025) AND section = '10_10' AND ceiling_minor = 2000000000;

UPDATE payroll.exemption_ceilings
  SET ceiling_minor = 250000000
  WHERE fy_start_year IN (2024, 2025) AND section = '10_10AA' AND ceiling_minor = 2500000000;

UPDATE payroll.exemption_ceilings
  SET ceiling_minor = 50000000
  WHERE fy_start_year IN (2024, 2025) AND section = '10_10B' AND ceiling_minor = 500000000;

UPDATE payroll.exemption_ceilings
  SET ceiling_minor = 50000000
  WHERE fy_start_year IN (2024, 2025) AND section = '10_10C' AND ceiling_minor = 500000000;

-- ---- 2) Seed FY2026-27 with the corrected values (carried forward as ------
-- ---- current law; see header) ----------------------------------------------
INSERT INTO payroll.exemption_ceilings (id, fy_start_year, section, ceiling_minor, notes)
VALUES
  (gen_random_uuid(), 2026, '10_10',   200000000, 'Gratuity ₹20L (carried forward, corrected 10x seed)'),
  (gen_random_uuid(), 2026, '10_10AA', 250000000, 'Leave encashment ₹25L (carried forward, corrected 10x seed)'),
  (gen_random_uuid(), 2026, '10_10B',  50000000,  'Retrenchment ₹5L (carried forward, corrected 10x seed)'),
  (gen_random_uuid(), 2026, '10_10C',  50000000,  'VRS ₹5L (carried forward, corrected 10x seed)')
ON CONFLICT (fy_start_year, section) DO NOTHING;
