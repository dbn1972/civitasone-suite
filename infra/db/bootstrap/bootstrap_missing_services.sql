-- Bootstrap for remaining services not yet in DB.
-- Run as civitas_admin. Idempotent.

-- ── crm ───────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'crm_svc') THEN
    CREATE ROLE crm_svc WITH LOGIN PASSWORD 'crm_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_crm OWNER crm_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_crm') \gexec
\connect civitas_crm
CREATE SCHEMA IF NOT EXISTS crm       AUTHORIZATION crm_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION crm_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION crm_svc;
GRANT ALL ON SCHEMA crm     TO crm_svc;
GRANT ALL ON SCHEMA _outbox TO crm_svc;
GRANT ALL ON SCHEMA _inbox  TO crm_svc;

-- ── analytics ────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_svc') THEN
    CREATE ROLE analytics_svc WITH LOGIN PASSWORD 'analytics_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_analytics OWNER analytics_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_analytics') \gexec
\connect civitas_analytics
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION analytics_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION analytics_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION analytics_svc;
GRANT ALL ON SCHEMA analytics TO analytics_svc;
GRANT ALL ON SCHEMA _outbox   TO analytics_svc;
GRANT ALL ON SCHEMA _inbox    TO analytics_svc;

-- ── helpdesk ─────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'helpdesk_svc') THEN
    CREATE ROLE helpdesk_svc WITH LOGIN PASSWORD 'helpdesk_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_helpdesk OWNER helpdesk_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_helpdesk') \gexec
\connect civitas_helpdesk
CREATE SCHEMA IF NOT EXISTS helpdesk AUTHORIZATION helpdesk_svc;
CREATE SCHEMA IF NOT EXISTS _outbox  AUTHORIZATION helpdesk_svc;
CREATE SCHEMA IF NOT EXISTS _inbox   AUTHORIZATION helpdesk_svc;
GRANT ALL ON SCHEMA helpdesk TO helpdesk_svc;
GRANT ALL ON SCHEMA _outbox  TO helpdesk_svc;
GRANT ALL ON SCHEMA _inbox   TO helpdesk_svc;

-- ── inventory ────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'inventory_svc') THEN
    CREATE ROLE inventory_svc WITH LOGIN PASSWORD 'inventory_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_inventory OWNER inventory_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_inventory') \gexec
\connect civitas_inventory
CREATE SCHEMA IF NOT EXISTS inventory AUTHORIZATION inventory_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION inventory_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION inventory_svc;
GRANT ALL ON SCHEMA inventory TO inventory_svc;
GRANT ALL ON SCHEMA _outbox   TO inventory_svc;
GRANT ALL ON SCHEMA _inbox    TO inventory_svc;

-- ── knowledge ────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'knowledge_svc') THEN
    CREATE ROLE knowledge_svc WITH LOGIN PASSWORD 'knowledge_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_knowledge OWNER knowledge_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_knowledge') \gexec
\connect civitas_knowledge
CREATE SCHEMA IF NOT EXISTS knowledge AUTHORIZATION knowledge_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION knowledge_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION knowledge_svc;
GRANT ALL ON SCHEMA knowledge TO knowledge_svc;
GRANT ALL ON SCHEMA _outbox   TO knowledge_svc;
GRANT ALL ON SCHEMA _inbox    TO knowledge_svc;

-- ── location ─────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'location_svc') THEN
    CREATE ROLE location_svc WITH LOGIN PASSWORD 'location_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_location OWNER location_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_location') \gexec
\connect civitas_location
CREATE SCHEMA IF NOT EXISTS location AUTHORIZATION location_svc;
CREATE SCHEMA IF NOT EXISTS _outbox  AUTHORIZATION location_svc;
CREATE SCHEMA IF NOT EXISTS _inbox   AUTHORIZATION location_svc;
GRANT ALL ON SCHEMA location TO location_svc;
GRANT ALL ON SCHEMA _outbox  TO location_svc;
GRANT ALL ON SCHEMA _inbox   TO location_svc;

-- ── plugin ───────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'plugin_svc') THEN
    CREATE ROLE plugin_svc WITH LOGIN PASSWORD 'plugin_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_plugin OWNER plugin_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_plugin') \gexec
\connect civitas_plugin
CREATE SCHEMA IF NOT EXISTS plugin  AUTHORIZATION plugin_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION plugin_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION plugin_svc;
GRANT ALL ON SCHEMA plugin  TO plugin_svc;
GRANT ALL ON SCHEMA _outbox TO plugin_svc;
GRANT ALL ON SCHEMA _inbox  TO plugin_svc;

-- ── report ───────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'report_svc') THEN
    CREATE ROLE report_svc WITH LOGIN PASSWORD 'report_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_report OWNER report_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_report') \gexec
\connect civitas_report
CREATE SCHEMA IF NOT EXISTS reports AUTHORIZATION report_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION report_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION report_svc;
GRANT ALL ON SCHEMA reports TO report_svc;
GRANT ALL ON SCHEMA _outbox TO report_svc;
GRANT ALL ON SCHEMA _inbox  TO report_svc;

-- ── telephony ────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'telephony_svc') THEN
    CREATE ROLE telephony_svc WITH LOGIN PASSWORD 'telephony_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_telephony OWNER telephony_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_telephony') \gexec
\connect civitas_telephony
CREATE SCHEMA IF NOT EXISTS telephony AUTHORIZATION telephony_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION telephony_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION telephony_svc;
GRANT ALL ON SCHEMA telephony TO telephony_svc;
GRANT ALL ON SCHEMA _outbox   TO telephony_svc;
GRANT ALL ON SCHEMA _inbox    TO telephony_svc;

-- ── theme ────────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'theme_svc') THEN
    CREATE ROLE theme_svc WITH LOGIN PASSWORD 'theme_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_theme OWNER theme_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_theme') \gexec
\connect civitas_theme
CREATE SCHEMA IF NOT EXISTS theme   AUTHORIZATION theme_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION theme_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION theme_svc;
GRANT ALL ON SCHEMA theme   TO theme_svc;
GRANT ALL ON SCHEMA _outbox TO theme_svc;
GRANT ALL ON SCHEMA _inbox  TO theme_svc;

-- ── workflow ─────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'workflow_svc') THEN
    CREATE ROLE workflow_svc WITH LOGIN PASSWORD 'workflow_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_workflow OWNER workflow_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_workflow') \gexec
\connect civitas_workflow
CREATE SCHEMA IF NOT EXISTS workflow AUTHORIZATION workflow_svc;
CREATE SCHEMA IF NOT EXISTS _outbox  AUTHORIZATION workflow_svc;
CREATE SCHEMA IF NOT EXISTS _inbox   AUTHORIZATION workflow_svc;
GRANT ALL ON SCHEMA workflow TO workflow_svc;
GRANT ALL ON SCHEMA _outbox  TO workflow_svc;
GRANT ALL ON SCHEMA _inbox   TO workflow_svc;

-- ── install ──────────────────────────────────────────────────────
\connect postgres
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'install_svc') THEN
    CREATE ROLE install_svc WITH LOGIN PASSWORD 'install_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_install OWNER install_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_install') \gexec
\connect civitas_install
CREATE SCHEMA IF NOT EXISTS install AUTHORIZATION install_svc;
CREATE SCHEMA IF NOT EXISTS _outbox AUTHORIZATION install_svc;
CREATE SCHEMA IF NOT EXISTS _inbox  AUTHORIZATION install_svc;
GRANT ALL ON SCHEMA install TO install_svc;
GRANT ALL ON SCHEMA _outbox TO install_svc;
GRANT ALL ON SCHEMA _inbox  TO install_svc;
