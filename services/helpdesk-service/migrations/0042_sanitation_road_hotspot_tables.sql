-- 0042_sanitation_road_hotspot_tables.sql
--
-- helpdesk.helpdesk_sanitation_complaints / helpdesk_sanitation_field_actions
-- (src/modules/sanitation/schema.ts) and helpdesk.helpdesk_road_hotspots /
-- helpdesk_road_hotspot_links (src/modules/road-hotspot/schema.ts) are declared
-- in Drizzle and queried by those modules' repos, but no migration ever
-- created them. Found by scripts/ci/schema-drift-guard.mjs (64 declared
-- columns with no database counterpart). Columns match the schema.ts files
-- verbatim.
--
-- Additive and idempotent. Rollback:
--   DROP TABLE IF EXISTS helpdesk.helpdesk_sanitation_field_actions,
--     helpdesk.helpdesk_sanitation_complaints,
--     helpdesk.helpdesk_road_hotspot_links, helpdesk.helpdesk_road_hotspots;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS helpdesk.helpdesk_sanitation_complaints (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               uuid NOT NULL,
  complaint_number        varchar(32) NOT NULL,
  reported_by             uuid NOT NULL,
  location                jsonb NOT NULL,
  facility_id             text,
  complaint_type          varchar(32) NOT NULL,
  description             text,
  photo                   text,
  severity                varchar(16) NOT NULL DEFAULT 'medium',
  status                  varchar(24) NOT NULL DEFAULT 'reported',
  assigned_to             uuid,
  assigned_at             timestamptz,
  resolved_at             timestamptz,
  resolution              text,
  citizen_feedback_rating integer,
  reopen_count            integer NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  created_by              uuid NOT NULL,
  updated_by              uuid NOT NULL,
  version                 integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_helpdesk_sanitation_complaints_tenant_status
  ON helpdesk.helpdesk_sanitation_complaints (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_helpdesk_sanitation_complaints_tenant_number
  ON helpdesk.helpdesk_sanitation_complaints (tenant_id, complaint_number);

CREATE TABLE IF NOT EXISTS helpdesk.helpdesk_sanitation_field_actions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL,
  complaint_id     uuid NOT NULL,
  action_type      varchar(24) NOT NULL,
  performed_by     uuid NOT NULL,
  performed_at     timestamptz NOT NULL DEFAULT now(),
  notes            text,
  before_photo     text,
  after_photo      text,
  duration_minutes integer,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  created_by       uuid NOT NULL,
  updated_by       uuid NOT NULL,
  version          integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_helpdesk_sanitation_field_actions_tenant
  ON helpdesk.helpdesk_sanitation_field_actions (tenant_id, complaint_id);

CREATE TABLE IF NOT EXISTS helpdesk.helpdesk_road_hotspots (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            uuid NOT NULL,
  hotspot_code         varchar(32) NOT NULL,
  location             jsonb NOT NULL,
  category             varchar(24) NOT NULL,
  complaint_count      integer NOT NULL DEFAULT 0,
  last_complaint_at    timestamptz,
  risk_score           integer NOT NULL DEFAULT 0,
  status               varchar(32) NOT NULL DEFAULT 'identified',
  maintenance_plan_ref text,
  resolved_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid NOT NULL,
  updated_by           uuid NOT NULL,
  version              integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_helpdesk_road_hotspots_tenant_status
  ON helpdesk.helpdesk_road_hotspots (tenant_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_helpdesk_road_hotspots_tenant_code
  ON helpdesk.helpdesk_road_hotspots (tenant_id, hotspot_code);

CREATE TABLE IF NOT EXISTS helpdesk.helpdesk_road_hotspot_links (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  uuid NOT NULL,
  hotspot_id uuid NOT NULL,
  ticket_id  uuid NOT NULL,
  linked_at  timestamptz NOT NULL DEFAULT now(),
  linked_by  uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL,
  updated_by uuid NOT NULL,
  version    integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_helpdesk_road_hotspot_links_tenant
  ON helpdesk.helpdesk_road_hotspot_links (tenant_id, hotspot_id);

-- Tenant isolation: helpdesk.current_tenant_id() (0005_rls_tenant_isolation.sql).
ALTER TABLE helpdesk.helpdesk_sanitation_complaints ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.helpdesk_sanitation_complaints FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.helpdesk_sanitation_complaints;
CREATE POLICY tenant_isolation_policy ON helpdesk.helpdesk_sanitation_complaints
  USING (tenant_id = helpdesk.current_tenant_id())
  WITH CHECK (tenant_id = helpdesk.current_tenant_id());

ALTER TABLE helpdesk.helpdesk_sanitation_field_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.helpdesk_sanitation_field_actions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.helpdesk_sanitation_field_actions;
CREATE POLICY tenant_isolation_policy ON helpdesk.helpdesk_sanitation_field_actions
  USING (tenant_id = helpdesk.current_tenant_id())
  WITH CHECK (tenant_id = helpdesk.current_tenant_id());

ALTER TABLE helpdesk.helpdesk_road_hotspots ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.helpdesk_road_hotspots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.helpdesk_road_hotspots;
CREATE POLICY tenant_isolation_policy ON helpdesk.helpdesk_road_hotspots
  USING (tenant_id = helpdesk.current_tenant_id())
  WITH CHECK (tenant_id = helpdesk.current_tenant_id());

ALTER TABLE helpdesk.helpdesk_road_hotspot_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE helpdesk.helpdesk_road_hotspot_links FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON helpdesk.helpdesk_road_hotspot_links;
CREATE POLICY tenant_isolation_policy ON helpdesk.helpdesk_road_hotspot_links
  USING (tenant_id = helpdesk.current_tenant_id())
  WITH CHECK (tenant_id = helpdesk.current_tenant_id());
