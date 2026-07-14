-- Pilot district organogram seed + acceptance proof (Wave-A EPIC-1).
-- Runs as location_svc under the real NOBYPASSRLS role with the tenant GUC set,
-- proving the org model works end-to-end under RLS (not as superuser).
\set tid '00000000-0000-0000-0000-000000000001'
\set actor '00000000-0000-0000-0000-0000000000aa'

SET ROLE location_svc;
SELECT set_config('app.tenant_id', :'tid', false);

-- Idempotent cleanup of any prior pilot rows (scoped by the PILOT- code prefix).
DELETE FROM jurisdiction.jurisdictions WHERE tenant_id = :'tid'::uuid;
DELETE FROM hierarchy.postings   WHERE tenant_id = :'tid'::uuid;
DELETE FROM hierarchy.positions  WHERE tenant_id = :'tid'::uuid AND code LIKE 'PILOT-%';
DELETE FROM hierarchy.offices    WHERE tenant_id = :'tid'::uuid AND code LIKE 'PILOT-%';
DELETE FROM hierarchy.administrative_units WHERE tenant_id = :'tid'::uuid AND code LIKE 'PILOT-%';

-- ── administrative units: State -> District -> Sub-division -> Tehsil ─────────
WITH s AS (
  INSERT INTO hierarchy.administrative_units (tenant_id, code, name, type, created_by, updated_by)
  VALUES (:'tid'::uuid, 'PILOT-ST', 'Pilot State', 'state', :'actor'::uuid, :'actor'::uuid)
  RETURNING id
), d AS (
  INSERT INTO hierarchy.administrative_units (tenant_id, code, name, type, parent_id, lgd_code, created_by, updated_by)
  SELECT :'tid'::uuid, 'PILOT-DIST', 'Pilot District', 'district', s.id, '123', :'actor'::uuid, :'actor'::uuid FROM s
  RETURNING id
), sd AS (
  INSERT INTO hierarchy.administrative_units (tenant_id, code, name, type, parent_id, created_by, updated_by)
  SELECT :'tid'::uuid, 'PILOT-SD', 'Pilot Sub-division', 'subdivision', d.id, :'actor'::uuid, :'actor'::uuid FROM d
  RETURNING id
)
INSERT INTO hierarchy.administrative_units (tenant_id, code, name, type, parent_id, created_by, updated_by)
SELECT :'tid'::uuid, 'PILOT-TEH', 'Pilot Tehsil', 'tehsil', sd.id, :'actor'::uuid, :'actor'::uuid FROM sd;

-- ── offices: Collectorate -> SDM office -> Tehsil office; SP -> DSP -> Thana ──
WITH du AS (SELECT id FROM hierarchy.administrative_units WHERE tenant_id=:'tid'::uuid AND code='PILOT-DIST'),
     su AS (SELECT id FROM hierarchy.administrative_units WHERE tenant_id=:'tid'::uuid AND code='PILOT-SD'),
     tu AS (SELECT id FROM hierarchy.administrative_units WHERE tenant_id=:'tid'::uuid AND code='PILOT-TEH'),
coll AS (
  INSERT INTO hierarchy.offices (tenant_id, code, name, office_type, domain, admin_unit_id, created_by, updated_by)
  SELECT :'tid'::uuid, 'PILOT-COLL', 'District Collectorate', 'collectorate', 'civil', du.id, :'actor'::uuid, :'actor'::uuid FROM du
  RETURNING id
),
sdm AS (
  INSERT INTO hierarchy.offices (tenant_id, code, name, office_type, domain, admin_unit_id, parent_office_id, created_by, updated_by)
  SELECT :'tid'::uuid, 'PILOT-SDM', 'SDM Office', 'sdm_office', 'revenue', su.id, coll.id, :'actor'::uuid, :'actor'::uuid FROM su, coll
  RETURNING id
),
teh AS (
  INSERT INTO hierarchy.offices (tenant_id, code, name, office_type, domain, admin_unit_id, parent_office_id, created_by, updated_by)
  SELECT :'tid'::uuid, 'PILOT-TEHO', 'Tehsil Office', 'tehsil_office', 'revenue', tu.id, sdm.id, :'actor'::uuid, :'actor'::uuid FROM tu, sdm
  RETURNING id
),
sp AS (
  INSERT INTO hierarchy.offices (tenant_id, code, name, office_type, domain, admin_unit_id, created_by, updated_by)
  SELECT :'tid'::uuid, 'PILOT-SP', 'SP Office', 'sp_office', 'police', du.id, :'actor'::uuid, :'actor'::uuid FROM du
  RETURNING id
),
dsp AS (
  INSERT INTO hierarchy.offices (tenant_id, code, name, office_type, domain, admin_unit_id, parent_office_id, created_by, updated_by)
  SELECT :'tid'::uuid, 'PILOT-DSP', 'DSP Sub-division', 'dsp_office', 'police', su.id, sp.id, :'actor'::uuid, :'actor'::uuid FROM su, sp
  RETURNING id
)
INSERT INTO hierarchy.offices (tenant_id, code, name, office_type, domain, admin_unit_id, parent_office_id, created_by, updated_by)
SELECT :'tid'::uuid, 'PILOT-PS', 'City Police Station', 'police_station', 'police', tu.id, dsp.id, :'actor'::uuid, :'actor'::uuid
FROM (SELECT id FROM hierarchy.administrative_units WHERE tenant_id=:'tid'::uuid AND code='PILOT-TEH') tu, dsp;

-- ── positions + postings + jurisdiction for the two chains ───────────────────
DO $$
DECLARE
  tid uuid := '00000000-0000-0000-0000-000000000001';
  actor uuid := '00000000-0000-0000-0000-0000000000aa';
  rec RECORD;
  pos_id uuid;
  emp int := 0;
BEGIN
  FOR rec IN
    SELECT o.id AS office_id, o.admin_unit_id, o.code AS ocode,
           CASE o.code
             WHEN 'PILOT-COLL' THEN 'District Collector'
             WHEN 'PILOT-SDM'  THEN 'Sub-Divisional Magistrate'
             WHEN 'PILOT-TEHO' THEN 'Tehsildar'
             WHEN 'PILOT-SP'   THEN 'Superintendent of Police'
             WHEN 'PILOT-DSP'  THEN 'Deputy Superintendent of Police'
             WHEN 'PILOT-PS'   THEN 'Station House Officer'
           END AS designation,
           (o.domain <> 'police') AS magisterial
    FROM hierarchy.offices o WHERE o.tenant_id = tid AND o.code LIKE 'PILOT-%'
  LOOP
    emp := emp + 1;
    INSERT INTO hierarchy.positions (tenant_id, code, office_id, designation, magisterial, financial_powers_minor, created_by, updated_by)
    VALUES (tid, 'PILOT-POS-'||rec.ocode, rec.office_id, rec.designation, rec.magisterial, 100000000, actor, actor)
    RETURNING id INTO pos_id;

    INSERT INTO hierarchy.postings (tenant_id, employee_id, position_id, office_id, charge_type, order_ref, created_by, updated_by)
    VALUES (tid, ('eeeeeeee-0001-0000-0000-0000000000'||lpad(emp::text,2,'0'))::uuid, pos_id, rec.office_id, 'substantive', 'GO/PILOT/'||emp, actor, actor);

    INSERT INTO jurisdiction.jurisdictions (tenant_id, office_id, unit_id, level, hierarchy_domain, is_primary, created_by, updated_by)
    SELECT tid, rec.office_id, rec.admin_unit_id, au.type,
           (SELECT domain FROM hierarchy.unit_types WHERE code = au.type), true, actor, actor
    FROM hierarchy.administrative_units au WHERE au.id = rec.admin_unit_id;
  END LOOP;
END $$;

-- ── ACCEPTANCE: "who is posted where, and which territory do they cover" ──────
-- Resolves under the real location_svc NOBYPASSRLS role with only the tenant GUC.
SELECT p.employee_id,
       pos.designation,
       o.name  AS office,
       o.office_type,
       o.domain,
       au.name AS jurisdiction_unit,
       j.level AS jurisdiction_level
FROM hierarchy.postings p
JOIN hierarchy.positions pos ON pos.id = p.position_id
JOIN hierarchy.offices   o   ON o.id  = p.office_id
JOIN jurisdiction.jurisdictions j ON j.office_id = o.id
JOIN hierarchy.administrative_units au ON au.id = j.unit_id
WHERE p.is_active
ORDER BY o.domain, pos.designation;

-- ── ACCEPTANCE: cross-tenant probe returns ZERO under a different tenant GUC ──
SELECT set_config('app.tenant_id', '00000000-0000-0000-0000-000000000002', false);
SELECT count(*) AS cross_tenant_visible_offices FROM hierarchy.offices;
RESET ROLE;
