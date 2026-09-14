-- 0041_sec80ccd1b_cap.sql
-- DOM-034: adds sec80ccd1b_cap_minor to statutory.statutory_config, the
-- third Chapter VI-A cap in this table alongside sec80c_cap_minor and
-- sec80d_cap_minor (migration 0038, extended to the 80C column by DOM-026/
-- DOM-030). Before this migration, payroll/gap-routes.ts's tax optimization
-- advisor (GET /v1/payroll/tax/optimization) independently hardcoded the
-- Sec 80CCD(1B) (additional NPS contribution) headroom at Rs 50,000 -- the
-- same bug class DOM-008/DOM-020/DOM-025/DOM-026/DOM-030 already fixed for
-- 80C/80D throughout payroll-service.
--
-- WHY THIS GETS THE SAME TREATMENT AS 80C/80D RATHER THAN STAYING A
-- HARDCODED CONSTANT (DOM-034's own investigation, see its gap-report row
-- and PR description for the full writeup): Sec 80CCD(1B), like 80C and
-- 80D, is a flat nationwide Income Tax Act ceiling with no legitimate
-- employer-level override in real Indian tax law -- but that is equally
-- true of 80C and 80D, and migration 0038's own rationale for making THEM
-- effective-dated/tenant-overridable was never "employers choose different
-- caps"; it was "changing any of these required a code deploy" (0038's
-- header comment, verbatim). That reasoning is section-agnostic and applies
-- identically here: a future Finance Act amendment to the Rs 50,000
-- 80CCD(1B) figure should be a new effective-dated row, not a
-- payroll-service code deploy. No part of this codebase (searched
-- payroll-service, finance-service, hrms-service, apps/web) treats
-- 80CCD(1B) as tenant-configurable today, and unlike 80C/80D it is not
-- applied in any real tax computation anywhere (computeSlip, Form-16,
-- tax/routes.ts's income-tax/tax-computation) -- only this one advisory
-- suggestion -- so there is no existing per-tenant divergence this
-- migration needs to preserve. The seeded default below is exactly the
-- figure that was hardcoded before this migration, applied automatically to
-- every existing row (platform default and any tenant overrides alike) via
-- the column default, so no existing response changes as a result of this
-- migration alone -- only a deliberate future override or a new
-- effective-dated platform row would ever change it.
--
-- ADD COLUMN ... NOT NULL DEFAULT <constant> is a metadata-only change on
-- PG11+ (no table rewrite, no long lock), same as every other ALTER TABLE
-- ADD COLUMN in this codebase (see migration 0016's header) -- safe under
-- the same 5s lock_timeout migration 0038 used for the original table.
--
-- Rollback: ALTER TABLE statutory.statutory_config DROP COLUMN sec80ccd1b_cap_minor;

SET lock_timeout = '5s';

ALTER TABLE statutory.statutory_config
  ADD COLUMN IF NOT EXISTS sec80ccd1b_cap_minor BIGINT NOT NULL DEFAULT 5000000; -- Rs 50,000, paise
