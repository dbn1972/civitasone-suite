-- hrms-service migration 0067 — DIC statutory + engagement-type-specific
-- employee identifiers.
--
-- Adds the identifiers a hybrid workforce needs that the master lacked:
--   • esic_ip_number — ESIC Insured Person number (statutory returns)
--   • pran           — NPS Permanent Retirement Account Number
--   • gstin, sac_code — Invoice Consultant (194J + GST)
--   • agency_ref      — Third-Party deployment/agency reference (CLRA)
--   • naps_id         — Apprentice NAPS/NATS registration
--
-- All nullable, additive; existing employees unaffected. Column-level access
-- inherits the existing table grants on employee.hrms_employees. Idempotent.

ALTER TABLE employee.hrms_employees
  ADD COLUMN IF NOT EXISTS esic_ip_number varchar(17),
  ADD COLUMN IF NOT EXISTS pran           varchar(12),
  ADD COLUMN IF NOT EXISTS gstin          varchar(15),
  ADD COLUMN IF NOT EXISTS sac_code       varchar(6),
  ADD COLUMN IF NOT EXISTS agency_ref     varchar(64),
  ADD COLUMN IF NOT EXISTS naps_id        varchar(24);
