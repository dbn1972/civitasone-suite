-- Purpose: G14 — Agent talking-point script library keyed by product + language.
-- Supports J2 step 3 (scripted talking points) and J3 step 4 (lapse-prevention visits).
-- Rollback: DROP TABLE IF EXISTS crm.agent_scripts;

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS crm.agent_scripts (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid        NOT NULL,
  product_code  varchar(120) NOT NULL,
  language      varchar(10)  NOT NULL,
  script_key    varchar(64)  NOT NULL,
  title         varchar(200) NOT NULL,
  body          text         NOT NULL,
  version_number int         NOT NULL DEFAULT 1,
  status        varchar(12)  NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft', 'published', 'deprecated')),
  tags          jsonb        NOT NULL DEFAULT '[]'::jsonb,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  created_by    uuid         NOT NULL,
  updated_by    uuid         NOT NULL,
  version       int          NOT NULL DEFAULT 1,
  CONSTRAINT uq_agent_script_version
    UNIQUE (tenant_id, product_code, language, script_key, version_number)
);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_scripts_tenant_product_lang
  ON crm.agent_scripts (tenant_id, product_code, language);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_agent_scripts_tenant_status
  ON crm.agent_scripts (tenant_id, status);
