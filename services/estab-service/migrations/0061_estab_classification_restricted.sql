-- D14 / D12 (owner-approved): file classification tiers Ordinary / Restricted / Confidential / Secret.
--  * files.estab_files.classification: admit 'restricted' (stored 'public' == "Ordinary", the D12 default).
--  * files.estab_inward.classification: new column, default 'public' (Ordinary), same domain.
-- Additive and idempotent. No data is rewritten; existing rows keep their value.
--
-- The old CHECK on estab_files.classification was declared inline in 0001_init.sql, so Postgres
-- auto-named it estab_files_classification_check. A drifted database may name it differently, so
-- every single-column CHECK on that column is dropped by catalogue lookup (not by assumed name)
-- before the widened one is added. Each swap runs in ONE DO block, so a failure leaves the old
-- constraint in place.
-- Rollback: drop estab_inward.classification and its CHECK; restore the 4-value estab_files CHECK
-- (only valid while no row holds 'restricted').
SET lock_timeout = '5s';

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'files.estab_files'::regclass
       AND con.contype = 'c'
       AND att.attname = 'classification'
  LOOP
    EXECUTE format('ALTER TABLE files.estab_files DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE files.estab_files
    ADD CONSTRAINT estab_files_classification_check
    CHECK (classification IN ('top_secret','secret','confidential','restricted','public'));
END $$;

ALTER TABLE files.estab_inward
  ADD COLUMN IF NOT EXISTS classification varchar(16) NOT NULL DEFAULT 'public';

DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'files.estab_inward'::regclass
       AND con.contype = 'c'
       AND att.attname = 'classification'
  LOOP
    EXECUTE format('ALTER TABLE files.estab_inward DROP CONSTRAINT %I', c.conname);
  END LOOP;
  ALTER TABLE files.estab_inward
    ADD CONSTRAINT estab_inward_classification_check
    CHECK (classification IN ('top_secret','secret','confidential','restricted','public'));
END $$;
