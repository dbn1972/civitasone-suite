-- 0026_item_substitutes_entity_shape.sql
--
-- GAP2-INVENTORY-SUBSTITUTES-01: inventory.item_substitutes was missing the
-- mandatory updated_at / updated_by / version columns required of every entity
-- (CLAUDE.md §3.6). Without version there is no optimistic-concurrency guard
-- and without updated_at/updated_by edits cannot be tracked. Every sibling
-- table in migration 0012 (bins, custodians, reservations, goods_returns)
-- already carries these columns; this brings item_substitutes into line.
--
-- Additive and idempotent. Existing rows backfill updated_at/version from
-- their defaults; updated_by backfills to created_by so no row is left NULL
-- before the column is made NOT NULL.
--
-- Rollback:
--   ALTER TABLE inventory.item_substitutes
--     DROP COLUMN IF EXISTS version,
--     DROP COLUMN IF EXISTS updated_by,
--     DROP COLUMN IF EXISTS updated_at;

SET lock_timeout = '5s';

ALTER TABLE inventory.item_substitutes
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_by UUID,
  ADD COLUMN IF NOT EXISTS version    INTEGER NOT NULL DEFAULT 1;

-- Backfill updated_by for pre-existing rows from created_by, then enforce NOT NULL.
UPDATE inventory.item_substitutes
   SET updated_by = created_by
 WHERE updated_by IS NULL;

ALTER TABLE inventory.item_substitutes
  ALTER COLUMN updated_by SET NOT NULL;
