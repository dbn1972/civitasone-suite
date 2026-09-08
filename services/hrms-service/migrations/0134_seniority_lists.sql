-- 0134_seniority_lists.sql
-- DOM-004: the seniority.generate/approve queue consumers persisted nothing
-- (literal // TODO stubs) while still emitting a "success" audit event. No
-- table existed for a generated seniority-list snapshot at all. This adds
-- the persisted snapshot (header + ranked entries) the consumer now writes.
-- Additive + idempotent. All tenant-scoped, FORCE RLS on app.tenant_id GUC.
--
-- Rollback:
--   DROP TABLE IF EXISTS seniority.hrms_seniority_list_entries;
--   DROP TABLE IF EXISTS seniority.hrms_seniority_lists;
--   DROP SCHEMA IF EXISTS seniority;

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS seniority;

-- A generated point-in-time seniority list snapshot. status moves
-- generated -> approved (one-way; re-generating for the same filter/asOf
-- creates a new row rather than mutating an existing one).
CREATE TABLE IF NOT EXISTS seniority.hrms_seniority_lists (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid NOT NULL,
  department_id   uuid,
  designation_id  uuid,
  as_of           date NOT NULL,
  status          varchar(16) NOT NULL DEFAULT 'generated',
  entry_count     integer NOT NULL DEFAULT 0,
  generated_by    uuid NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  approved_by     uuid,
  approved_at     timestamptz,
  remarks         text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  version         integer NOT NULL DEFAULT 1,
  CONSTRAINT hrms_seniority_lists_status_check CHECK (status IN ('generated','approved'))
);
CREATE INDEX IF NOT EXISTS hrms_seniority_lists_tenant_idx
  ON seniority.hrms_seniority_lists (tenant_id, as_of);

-- Ranked entries captured at generation time — the immutable snapshot rows.
CREATE TABLE IF NOT EXISTS seniority.hrms_seniority_list_entries (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  seniority_list_id  uuid NOT NULL,
  rank               integer NOT NULL,
  employee_id        uuid NOT NULL,
  employee_no        text NOT NULL,
  full_name          text NOT NULL,
  designation_id     uuid NOT NULL,
  department_id      uuid NOT NULL,
  date_of_joining    date NOT NULL,
  date_of_birth      date,
  merit_grade        numeric(4,2),
  qualifying_years   numeric(6,2) NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hrms_seniority_list_entries_uq UNIQUE (tenant_id, seniority_list_id, rank)
);
CREATE INDEX IF NOT EXISTS hrms_seniority_list_entries_list_idx
  ON seniority.hrms_seniority_list_entries (tenant_id, seniority_list_id);

-- ── RLS for new tables ────────────────────────────────────────────────────────
DO $$ DECLARE t text; s text; BEGIN
  FOR t, s IN VALUES
    ('hrms_seniority_lists','seniority'),
    ('hrms_seniority_list_entries','seniority')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', s, t);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', s, t);
    EXECUTE format('DROP POLICY IF EXISTS %I_tenant ON %I.%I', t, s, t);
    EXECUTE format('CREATE POLICY %I_tenant ON %I.%I USING (tenant_id = current_setting(''app.tenant_id'', true)::uuid) WITH CHECK (tenant_id = current_setting(''app.tenant_id'', true)::uuid)', t, s, t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I.%I TO hrms_svc', s, t);
  END LOOP;
END $$;
