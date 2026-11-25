-- D14 / D12 (owner-approved): file classification tiers Ordinary / Restricted / Confidential / Secret.
--  * files.estab_files.classification: admit 'restricted' (stored 'public' == "Ordinary", the D12 default).
--  * files.estab_inward.classification: new column, default 'public' (Ordinary), same domain.
-- Additive and idempotent. No data is rewritten; existing rows keep their value.
-- Each constraint swap runs in ONE DO block so a failure leaves the old constraint in place.
-- Rollback: drop estab_inward.classification and its CHECK; restore the 4-value estab_files CHECK
-- (only valid while no row holds 'restricted').
SET lock_timeout = '5s';

DO $$
BEGIN
  ALTER TABLE files.estab_files DROP CONSTRAINT IF EXISTS estab_files_classification_check;
  ALTER TABLE files.estab_files
    ADD CONSTRAINT estab_files_classification_check
    CHECK (classification IN ('top_secret','secret','confidential','restricted','public'));
END $$;

ALTER TABLE files.estab_inward
  ADD COLUMN IF NOT EXISTS classification varchar(16) NOT NULL DEFAULT 'public';

DO $$
BEGIN
  ALTER TABLE files.estab_inward DROP CONSTRAINT IF EXISTS estab_inward_classification_check;
  ALTER TABLE files.estab_inward
    ADD CONSTRAINT estab_inward_classification_check
    CHECK (classification IN ('top_secret','secret','confidential','restricted','public'));
END $$;
