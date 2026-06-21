-- report-service: KPI definitions for dashboards and MIS views

CREATE TABLE IF NOT EXISTS reports.kpis (
  id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid         NOT NULL,
  kpi_name       varchar(200) NOT NULL,
  module         varchar(64)  NOT NULL,
  target_value   numeric      NOT NULL DEFAULT 0,
  current_value  numeric      NOT NULL DEFAULT 0,
  unit           varchar(32)  NOT NULL DEFAULT '',
  period         varchar(32)  NOT NULL DEFAULT '',
  trend          varchar(16)  NOT NULL DEFAULT 'stable',
  status         varchar(16)  NOT NULL DEFAULT 'on_track',
  created_at     timestamptz  NOT NULL DEFAULT now(),
  updated_at     timestamptz  NOT NULL DEFAULT now(),
  created_by     uuid         NOT NULL,
  updated_by     uuid         NOT NULL,
  version        integer      NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_kpis_tenant_module ON reports.kpis (tenant_id, module);

ALTER TABLE reports.kpis OWNER TO report_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON reports.kpis TO report_svc;
