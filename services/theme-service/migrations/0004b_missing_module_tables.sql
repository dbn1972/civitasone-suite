-- 0004b_missing_module_tables.sql
-- branding.tenant_branding and templates.templates are declared in Drizzle
-- (src/modules/branding/schema.ts, src/modules/templates/schema.ts) but no
-- migration ever created either table. Schema `branding` is created by the DB
-- bootstrap (bootstrap_missing_schemas.sql); schema `templates` likewise (added
-- there for theme_svc alongside it — see that file). Tables here, columns
-- matching the schema.ts files verbatim.

CREATE TABLE IF NOT EXISTS branding.tenant_branding (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid NOT NULL,
  logo_s3_key        text,
  favicon_s3_key     text,
  app_name           text NOT NULL DEFAULT 'CivitasOne',
  primary_color      text NOT NULL DEFAULT '#1e40af',
  accent_color       text NOT NULL DEFAULT '#f59e0b',
  footer_text        text,
  custom_email_from  text,
  powered_by_hidden  boolean NOT NULL DEFAULT false,
  custom_login_html  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  created_by         uuid NOT NULL,
  updated_by         uuid NOT NULL,
  version            integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_tenant_branding_tenant ON branding.tenant_branding(tenant_id);

CREATE TABLE IF NOT EXISTS templates.templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL,
  type        varchar(24) NOT NULL,
  name        varchar(256) NOT NULL,
  html_body   text NOT NULL,
  variables   jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid NOT NULL,
  updated_by  uuid NOT NULL,
  version     integer NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_templates_tenant ON templates.templates(tenant_id);
