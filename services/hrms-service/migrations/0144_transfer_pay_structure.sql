-- 0144_transfer_pay_structure.sql
-- HIGH fix (cross-module integration audit follow-up): a transfer to a new
-- department can imply a different pay scale/structure, but neither transfer
-- path (direct employee/consumer.ts, or the eOffice-approved
-- lifecycle/eoffice-consumer.ts) had anywhere to carry an intended new
-- payStructureId. Additive, backward compatible: nullable, no default --
-- existing transfer rows and any transfer that doesn't change pay-structure
-- simply read NULL here.
ALTER TABLE lifecycle.hrms_transfers ADD COLUMN IF NOT EXISTS pay_structure_id uuid;
