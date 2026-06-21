-- estab-service: add committee.estab_compliance table
-- Applied with estab_svc role on civitas_estab.

CREATE TABLE IF NOT EXISTS committee.estab_compliance (
  id                 uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid        NOT NULL,
  compliance_code    text        NOT NULL,
  title              text        NOT NULL,
  category           text        NOT NULL,
  frequency          varchar(24) NOT NULL DEFAULT 'monthly'
                     CHECK (frequency IN ('daily','weekly','monthly','quarterly','annual','one_time')),
  due_date           date        NOT NULL,
  assigned_to        uuid,
  status             varchar(24) NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','complied','overdue','not_applicable')),
  last_complied_date date,
  remarks            text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid        NOT NULL,
  updated_by         uuid        NOT NULL,
  version            integer     NOT NULL DEFAULT 1,
  UNIQUE (tenant_id, compliance_code)
);

CREATE INDEX IF NOT EXISTS idx_estab_compliance_tenant_status
  ON committee.estab_compliance(tenant_id, status);
