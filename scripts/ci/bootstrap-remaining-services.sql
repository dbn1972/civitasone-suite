-- Remaining service DBs not covered by bootstrap.generated / bootstrap_new_services.
-- Run as Postgres superuser (CI: civitas).

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_svc') THEN
    CREATE ROLE crm_svc WITH LOGIN PASSWORD 'crm_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_crm OWNER crm_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_crm') \gexec
\connect civitas_crm
CREATE SCHEMA IF NOT EXISTS crm        AUTHORIZATION crm_svc;
CREATE SCHEMA IF NOT EXISTS _outbox    AUTHORIZATION crm_svc;
CREATE SCHEMA IF NOT EXISTS _inbox     AUTHORIZATION crm_svc;
GRANT ALL ON SCHEMA crm     TO crm_svc;
GRANT ALL ON SCHEMA _outbox TO crm_svc;
GRANT ALL ON SCHEMA _inbox  TO crm_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA crm     TO crm_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _outbox TO crm_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _inbox  TO crm_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA crm     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO crm_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'hrms_svc') THEN
    CREATE ROLE hrms_svc WITH LOGIN PASSWORD 'hrms_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_hrms OWNER hrms_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_hrms') \gexec
\connect civitas_hrms
CREATE SCHEMA IF NOT EXISTS employee    AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS recruitment AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS attendance  AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS leave       AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS training    AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS lifecycle   AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION hrms_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION hrms_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'payroll_svc') THEN
    CREATE ROLE payroll_svc WITH LOGIN PASSWORD 'payroll_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_payroll OWNER payroll_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_payroll') \gexec
\connect civitas_payroll
CREATE SCHEMA IF NOT EXISTS payroll AUTHORIZATION payroll_svc;
CREATE SCHEMA IF NOT EXISTS loans   AUTHORIZATION payroll_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION payroll_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION payroll_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'project_svc') THEN
    CREATE ROLE project_svc WITH LOGIN PASSWORD 'project_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_project OWNER project_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_project') \gexec
\connect civitas_project
CREATE SCHEMA IF NOT EXISTS project     AUTHORIZATION project_svc;
CREATE SCHEMA IF NOT EXISTS scheme      AUTHORIZATION project_svc;
CREATE SCHEMA IF NOT EXISTS progress    AUTHORIZATION project_svc;
CREATE SCHEMA IF NOT EXISTS utilisation AUTHORIZATION project_svc;
CREATE SCHEMA IF NOT EXISTS geo         AUTHORIZATION project_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION project_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION project_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'asset_svc') THEN
    CREATE ROLE asset_svc WITH LOGIN PASSWORD 'asset_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_asset OWNER asset_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_asset') \gexec
\connect civitas_asset
CREATE SCHEMA IF NOT EXISTS register     AUTHORIZATION asset_svc;
CREATE SCHEMA IF NOT EXISTS lifecycle    AUTHORIZATION asset_svc;
CREATE SCHEMA IF NOT EXISTS depreciation AUTHORIZATION asset_svc;
CREATE SCHEMA IF NOT EXISTS maintenance  AUTHORIZATION asset_svc;
CREATE SCHEMA IF NOT EXISTS insurance    AUTHORIZATION asset_svc;
CREATE SCHEMA IF NOT EXISTS _outbox      AUTHORIZATION asset_svc;
CREATE SCHEMA IF NOT EXISTS _inbox       AUTHORIZATION asset_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'stock_svc') THEN
    CREATE ROLE stock_svc WITH LOGIN PASSWORD 'stock_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_stock OWNER stock_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_stock') \gexec
\connect civitas_stock
CREATE SCHEMA IF NOT EXISTS item      AUTHORIZATION stock_svc;
CREATE SCHEMA IF NOT EXISTS warehouse AUTHORIZATION stock_svc;
CREATE SCHEMA IF NOT EXISTS entry     AUTHORIZATION stock_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION stock_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION stock_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'estab_svc') THEN
    CREATE ROLE estab_svc WITH LOGIN PASSWORD 'estab_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_estab OWNER estab_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_estab') \gexec
\connect civitas_estab
CREATE SCHEMA IF NOT EXISTS files     AUTHORIZATION estab_svc;
CREATE SCHEMA IF NOT EXISTS committee AUTHORIZATION estab_svc;
CREATE SCHEMA IF NOT EXISTS assets    AUTHORIZATION estab_svc;
CREATE SCHEMA IF NOT EXISTS facilities AUTHORIZATION estab_svc;
CREATE SCHEMA IF NOT EXISTS legal     AUTHORIZATION estab_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION estab_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION estab_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'theme_svc') THEN
    CREATE ROLE theme_svc WITH LOGIN PASSWORD 'theme_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_theme OWNER theme_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_theme') \gexec
\connect civitas_theme
CREATE SCHEMA IF NOT EXISTS themes AUTHORIZATION theme_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION theme_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION theme_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'plugin_svc') THEN
    CREATE ROLE plugin_svc WITH LOGIN PASSWORD 'plugin_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_plugin OWNER plugin_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_plugin') \gexec
\connect civitas_plugin
CREATE SCHEMA IF NOT EXISTS plugins AUTHORIZATION plugin_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION plugin_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION plugin_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'install_svc') THEN
    CREATE ROLE install_svc WITH LOGIN PASSWORD 'install_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_install OWNER install_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_install') \gexec
\connect civitas_install
CREATE SCHEMA IF NOT EXISTS install AUTHORIZATION install_svc;
CREATE SCHEMA IF NOT EXISTS _outbox  AUTHORIZATION install_svc;
CREATE SCHEMA IF NOT EXISTS _inbox   AUTHORIZATION install_svc;
