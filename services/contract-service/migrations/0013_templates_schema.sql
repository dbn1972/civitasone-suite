-- 0013_templates_schema.sql
--
-- Purpose: create the `templates` schema and its two tables, which the Drizzle
-- models have declared since the templates module was written but which no
-- migration ever created.
--
-- DEFECT THIS FIXES (P0, live)
-- `src/modules/templates/schema.ts` declares templates.contract_templates (10
-- columns) and templates.template_clauses (13). Neither existed — the `templates`
-- schema was absent from civitas_contract entirely. Every request to the
-- templates module was a 500 against the running fleet:
--
--   GET http://localhost:3009/v1/contract/templates
--   -> 500 {"statusCode":500,"code":"42P01",
--           "message":"relation \"templates.contract_templates\" does not exist"}
--
-- Found by scripts/ci/schema-drift-guard.mjs (all 23 columns reported missing).
-- Confirmed by hand: no file under services/contract-service/migrations/ mentions
-- contract_templates, and pg_namespace held no `templates` schema.
--
-- Types taken directly from the models, not inferred:
--   varchar(name,{length:500})     -> varchar(500)
--   varchar(status,{length:24})    -> varchar(24)
--   timestamp({withTimezone:true}) -> timestamptz
--   integer / text / uuid          -> as declared
-- `description` is `.notNull().default("")` in the model, so the column is
-- NOT NULL DEFAULT '' rather than nullable — matching the model exactly is the
-- point of this migration.
--
-- Rollback:
--   DROP TABLE IF EXISTS templates.template_clauses;
--   DROP TABLE IF EXISTS templates.contract_templates;
--   DROP SCHEMA IF EXISTS templates;
--   (Safe: schema and tables are new and hold no data prior to this migration.)
--
-- Affected services: contract-service (templates module)
-- Additive and idempotent.

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS templates;

CREATE TABLE IF NOT EXISTS templates.contract_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid         NOT NULL,
  name        varchar(500) NOT NULL,
  description text         NOT NULL DEFAULT '',
  status      varchar(24)  NOT NULL DEFAULT 'draft',
  version     integer      NOT NULL DEFAULT 1,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  created_by  uuid         NOT NULL,
  updated_by  uuid         NOT NULL
);

CREATE TABLE IF NOT EXISTS templates.template_clauses (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          uuid         NOT NULL,
  template_id        uuid         NOT NULL,
  clause_id          uuid         NOT NULL,
  rank               integer      NOT NULL,
  condition_type     varchar(24)  NOT NULL DEFAULT 'always',
  condition_field    varchar(200),
  condition_operator varchar(24),
  condition_value    varchar(500),
  created_at         timestamptz  NOT NULL DEFAULT now(),
  updated_at         timestamptz  NOT NULL DEFAULT now(),
  created_by         uuid         NOT NULL,
  updated_by         uuid         NOT NULL
);

-- Domains enumerated from the code that writes these columns, not guessed:
--   TEMPLATE_STATUSES  = ["draft","published","archived"]        (domain.ts:21)
--   CONDITION_TYPES    = ["always","conditional"]                (domain.ts:25)
--   CONDITION_OPERATORS= ["eq","neq","gt","gte","lt","lte","contains","in"]
-- These are the same lists the zod validators enforce at the route boundary, so
-- the constraint is a database-level backstop for the same rule rather than a
-- second, divergent definition.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'contract_templates_status_check'
                    AND conrelid = 'templates.contract_templates'::regclass) THEN
    ALTER TABLE templates.contract_templates
      ADD CONSTRAINT contract_templates_status_check
      CHECK (status IN ('draft', 'published', 'archived'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'template_clauses_condition_type_check'
                    AND conrelid = 'templates.template_clauses'::regclass) THEN
    ALTER TABLE templates.template_clauses
      ADD CONSTRAINT template_clauses_condition_type_check
      CHECK (condition_type IN ('always', 'conditional'));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'template_clauses_condition_operator_check'
                    AND conrelid = 'templates.template_clauses'::regclass) THEN
    ALTER TABLE templates.template_clauses
      ADD CONSTRAINT template_clauses_condition_operator_check
      CHECK (condition_operator IS NULL
             OR condition_operator IN ('eq','neq','gt','gte','lt','lte','contains','in'));
  END IF;
END
$$;

-- A clause appears at most once per template, and ranks are unique within a
-- template so ordering is deterministic. Database-level UNIQUE, not just an
-- application check, per the platform concurrency rule.
CREATE UNIQUE INDEX IF NOT EXISTS template_clauses_template_clause_uk
  ON templates.template_clauses (tenant_id, template_id, clause_id);
CREATE UNIQUE INDEX IF NOT EXISTS template_clauses_template_rank_uk
  ON templates.template_clauses (tenant_id, template_id, rank);

CREATE INDEX IF NOT EXISTS contract_templates_tenant_idx  ON templates.contract_templates (tenant_id);
CREATE INDEX IF NOT EXISTS contract_templates_status_idx   ON templates.contract_templates (tenant_id, status);
CREATE INDEX IF NOT EXISTS template_clauses_tenant_idx     ON templates.template_clauses (tenant_id);
CREATE INDEX IF NOT EXISTS template_clauses_template_idx   ON templates.template_clauses (tenant_id, template_id);

-- Tenant isolation. Uses contracts.current_tenant_id() from
-- 0003_rls_tenant_isolation.sql so there is one definition per database.
--
-- NOTE: the pre-existing policies in 0003 use USING only. These new tables add
-- WITH CHECK as well, so a write cannot insert a row for another tenant, not just
-- fail to read one. The absence of WITH CHECK on the older tables is a separate
-- finding and is not changed here.
ALTER TABLE templates.contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates.contract_templates FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON templates.contract_templates;
CREATE POLICY tenant_isolation ON templates.contract_templates
  USING (tenant_id = contracts.current_tenant_id())
  WITH CHECK (tenant_id = contracts.current_tenant_id());

ALTER TABLE templates.template_clauses ENABLE ROW LEVEL SECURITY;
ALTER TABLE templates.template_clauses FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON templates.template_clauses;
CREATE POLICY tenant_isolation ON templates.template_clauses
  USING (tenant_id = contracts.current_tenant_id())
  WITH CHECK (tenant_id = contracts.current_tenant_id());

COMMENT ON TABLE templates.contract_templates IS
  'Reusable contract templates. Clause composition lives in templates.template_clauses.';
COMMENT ON TABLE templates.template_clauses IS
  'Ordered clause membership of a template, with optional conditional inclusion rules.';
