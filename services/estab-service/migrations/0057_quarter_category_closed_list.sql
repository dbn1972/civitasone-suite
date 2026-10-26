-- 0057_quarter_category_closed_list.sql
-- GAP-ESTAB-QUARTERS-04 (owner decision #31, 2026-10-26): quarter Category is a CLOSED list
-- (general, physically_handicapped, medical, defence, other). Legacy free-text values already in
-- quarters.estab_quarters are mapped onto it by quarters.map_legacy_category(); anything that cannot be
-- mapped becomes 'other_legacy' ("Other (legacy)"), a value the API never accepts but the table keeps.
-- Rollback: ALTER TABLE quarters.estab_quarters DROP CONSTRAINT IF EXISTS chk_estab_quarters_category;
--           DROP FUNCTION IF EXISTS quarters.map_legacy_category(text);
--           (the remapped category values are NOT restored - take a backup first if you need the raw text)
-- Affected services: estab-service only.
--
-- NO FORCE ... FORCE: this migration runs as the table OWNER (estab_svc), which is NOBYPASSRLS, so the
-- FORCE RLS added by 0040 applies to it too. The backfill is a cross-tenant statement with no
-- app.tenant_id GUC, so under FORCE it would silently update ZERO rows and the CHECK below would then
-- fail (or, worse, be skipped). FORCE is dropped for the single backfill statement and restored at once
-- (the sanctioned backfill idiom). Every row keeps its own tenant_id; nothing crosses a tenant boundary.

SET lock_timeout = '5s';

CREATE OR REPLACE FUNCTION quarters.map_legacy_category(raw text) RETURNS text
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE regexp_replace(lower(btrim(coalesce(raw, ''))), '[\s-]+', '_', 'g')
    WHEN 'general' THEN 'general' WHEN 'gen' THEN 'general' WHEN 'gp' THEN 'general'
    WHEN 'general_pool' THEN 'general' WHEN 'normal' THEN 'general'
    WHEN 'physically_handicapped' THEN 'physically_handicapped' WHEN 'handicapped' THEN 'physically_handicapped'
    WHEN 'ph' THEN 'physically_handicapped' WHEN 'pwd' THEN 'physically_handicapped'
    WHEN 'pwbd' THEN 'physically_handicapped' WHEN 'divyang' THEN 'physically_handicapped'
    WHEN 'disabled' THEN 'physically_handicapped' WHEN 'physically_challenged' THEN 'physically_handicapped'
    WHEN 'medical' THEN 'medical' WHEN 'medical_ground' THEN 'medical' WHEN 'health' THEN 'medical'
    WHEN 'defence' THEN 'defence' WHEN 'defense' THEN 'defence' WHEN 'military' THEN 'defence' WHEN 'army' THEN 'defence'
    WHEN 'other' THEN 'other' WHEN 'others' THEN 'other'
    ELSE 'other_legacy'
  END
$$;

ALTER TABLE quarters.estab_quarters NO FORCE ROW LEVEL SECURITY;

UPDATE quarters.estab_quarters
   SET category = quarters.map_legacy_category(category)
 WHERE category NOT IN ('general', 'physically_handicapped', 'medical', 'defence', 'other', 'other_legacy');

ALTER TABLE quarters.estab_quarters FORCE ROW LEVEL SECURITY;

ALTER TABLE quarters.estab_quarters DROP CONSTRAINT IF EXISTS chk_estab_quarters_category;
ALTER TABLE quarters.estab_quarters
  ADD CONSTRAINT chk_estab_quarters_category
  CHECK (category IN ('general', 'physically_handicapped', 'medical', 'defence', 'other', 'other_legacy'));
