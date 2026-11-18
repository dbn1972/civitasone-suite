-- 0188_psu_shareholdings.sql
-- PSU v1 slice C (1/2): the shareholding / cap-table REGISTER -- the share-capital structure of a government-owned commercial
-- company (holder, category incl. President of India / other govt, share class, shares, face value). ADDITIVE and dormant: the
-- routes that write it sit behind a centralised gate (coa_template = commercial AND govt_owned), so a govt / non-PSU tenant never
-- gets a row. The register ties to the equity section of the Balance Sheet / SOCIE (paid-up = shares x face value vs the share-
-- capital head) and yields the government-ownership % for disclosure. Statutory classification of categories is CA/CS-VERIFY.
-- Table spec: tenant_id NOT NULL; ENABLE + FORCE RLS; tenant_isolation_policy USING + WITH CHECK; UNIQUE(tenant_id,id);
-- audit columns + optimistic version; tenant-first index. New table is empty, so a plain index is lock-safe.
-- Rollback (only while empty): DROP TABLE gl.psu_shareholdings;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS gl.psu_shareholdings (
  id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid         NOT NULL,
  holder_name      text         NOT NULL,
  category         varchar(24)  NOT NULL,
  share_class      varchar(12)  NOT NULL DEFAULT 'equity',
  shares           bigint       NOT NULL,
  face_value_minor bigint       NOT NULL,
  folio            varchar(32),
  status           varchar(10)  NOT NULL DEFAULT 'active',
  remarks          text,
  created_by       uuid         NOT NULL,
  created_at       timestamptz  NOT NULL DEFAULT now(),
  updated_by       uuid         NOT NULL,
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  version          integer      NOT NULL DEFAULT 1,
  CONSTRAINT psu_shareholdings_tenant_id_id_key UNIQUE (tenant_id, id),
  CONSTRAINT psu_shareholdings_holder_check   CHECK (length(btrim(holder_name)) > 0),
  CONSTRAINT psu_shareholdings_category_check CHECK (category IN
    ('president_of_india', 'other_govt', 'govt_body', 'public_sector_entity', 'institution', 'public', 'employee', 'other')),
  CONSTRAINT psu_shareholdings_class_check    CHECK (share_class IN ('equity', 'preference')),
  CONSTRAINT psu_shareholdings_shares_check   CHECK (shares > 0),
  CONSTRAINT psu_shareholdings_face_check     CHECK (face_value_minor > 0),
  CONSTRAINT psu_shareholdings_status_check   CHECK (status IN ('active', 'retired'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_psu_shareholdings_folio ON gl.psu_shareholdings (tenant_id, share_class, folio) WHERE folio IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_psu_shareholdings_tenant_class ON gl.psu_shareholdings (tenant_id, share_class, status);

ALTER TABLE gl.psu_shareholdings ENABLE ROW LEVEL SECURITY;
ALTER TABLE gl.psu_shareholdings FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation_policy ON gl.psu_shareholdings;
CREATE POLICY tenant_isolation_policy ON gl.psu_shareholdings
  USING (tenant_id = budget.current_tenant_id()) WITH CHECK (tenant_id = budget.current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'finance_svc') THEN
    GRANT SELECT, INSERT, UPDATE ON gl.psu_shareholdings TO finance_svc;
  END IF;
END
$$;
