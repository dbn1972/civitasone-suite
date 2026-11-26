-- Purpose: owner decision C35 (GAP-WORKS-TENDERS-NEW-02) - optional estimated amount, approving authority and contractor class
--          on a pre-tender, so the tender register/detail can show them. All nullable: existing rows stay valid and the
--          web shows an em dash until they are populated.
-- Rollback: ALTER TABLE works.pre_tenders DROP COLUMN IF EXISTS tender_amount_minor, DROP COLUMN IF EXISTS approving_authority_id, DROP COLUMN IF EXISTS contractor_class_id;
-- Affected services: works-service

SET lock_timeout = '5s';

ALTER TABLE works.pre_tenders ADD COLUMN IF NOT EXISTS tender_amount_minor bigint;
ALTER TABLE works.pre_tenders ADD COLUMN IF NOT EXISTS approving_authority_id uuid;
ALTER TABLE works.pre_tenders ADD COLUMN IF NOT EXISTS contractor_class_id uuid;
