-- Bootstrap for grant, citizen, legal, admin services (run as civitas_admin)

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'grant_svc') THEN
    CREATE ROLE grant_svc WITH LOGIN PASSWORD 'grant_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_grant OWNER grant_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_grant') \gexec
\connect civitas_grant
CREATE SCHEMA IF NOT EXISTS scheme        AUTHORIZATION grant_svc;
CREATE SCHEMA IF NOT EXISTS application   AUTHORIZATION grant_svc;
CREATE SCHEMA IF NOT EXISTS disbursement  AUTHORIZATION grant_svc;
CREATE SCHEMA IF NOT EXISTS utilisation   AUTHORIZATION grant_svc;
CREATE SCHEMA IF NOT EXISTS beneficiary   AUTHORIZATION grant_svc;
CREATE SCHEMA IF NOT EXISTS _outbox       AUTHORIZATION grant_svc;
CREATE SCHEMA IF NOT EXISTS _inbox        AUTHORIZATION grant_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'citizen_svc') THEN
    CREATE ROLE citizen_svc WITH LOGIN PASSWORD 'citizen_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_citizen OWNER citizen_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_citizen') \gexec
\connect civitas_citizen
CREATE SCHEMA IF NOT EXISTS portal       AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS application  AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS grievance    AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS rti          AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS helpdesk     AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS analytics    AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS _outbox      AUTHORIZATION citizen_svc;
CREATE SCHEMA IF NOT EXISTS _inbox       AUTHORIZATION citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA portal      TO citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA application  TO citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA grievance    TO citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rti          TO citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA helpdesk     TO citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA analytics    TO citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _outbox      TO citizen_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _inbox       TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA portal      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA application GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA grievance   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA rti         GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA helpdesk    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox     GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox      GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO citizen_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'legal_svc') THEN
    CREATE ROLE legal_svc WITH LOGIN PASSWORD 'legal_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_legal OWNER legal_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_legal') \gexec
\connect civitas_legal
CREATE SCHEMA IF NOT EXISTS cases       AUTHORIZATION legal_svc;
CREATE SCHEMA IF NOT EXISTS hearings    AUTHORIZATION legal_svc;
CREATE SCHEMA IF NOT EXISTS notices     AUTHORIZATION legal_svc;
CREATE SCHEMA IF NOT EXISTS contracts   AUTHORIZATION legal_svc;
CREATE SCHEMA IF NOT EXISTS settlements AUTHORIZATION legal_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION legal_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION legal_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'admin_svc') THEN
    CREATE ROLE admin_svc WITH LOGIN PASSWORD 'admin_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_admin OWNER admin_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_admin') \gexec
\connect civitas_admin
CREATE SCHEMA IF NOT EXISTS tenants  AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS config   AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS health   AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS backup   AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS support  AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS _outbox  AUTHORIZATION admin_svc;
CREATE SCHEMA IF NOT EXISTS _inbox   AUTHORIZATION admin_svc;

-- report, inventory, telephony services

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'report_svc') THEN
    CREATE ROLE report_svc WITH LOGIN PASSWORD 'report_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_report OWNER report_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_report') \gexec
\connect civitas_report
CREATE SCHEMA IF NOT EXISTS reports   AUTHORIZATION report_svc;
CREATE SCHEMA IF NOT EXISTS _outbox   AUTHORIZATION report_svc;
CREATE SCHEMA IF NOT EXISTS _inbox    AUTHORIZATION report_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'inventory_svc') THEN
    CREATE ROLE inventory_svc WITH LOGIN PASSWORD 'inventory_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_inventory OWNER inventory_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_inventory') \gexec
\connect civitas_inventory
CREATE SCHEMA IF NOT EXISTS inventory AUTHORIZATION inventory_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION inventory_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION inventory_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'telephony_svc') THEN
    CREATE ROLE telephony_svc WITH LOGIN PASSWORD 'telephony_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_telephony OWNER telephony_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_telephony') \gexec
\connect civitas_telephony
CREATE SCHEMA IF NOT EXISTS telephony AUTHORIZATION telephony_svc;
CREATE SCHEMA IF NOT EXISTS _outbox    AUTHORIZATION telephony_svc;
CREATE SCHEMA IF NOT EXISTS _inbox     AUTHORIZATION telephony_svc;

-- helpdesk, location services

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
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA helpdesk TO helpdesk_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _outbox  TO helpdesk_svc;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA _inbox   TO helpdesk_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA helpdesk GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helpdesk_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _outbox  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helpdesk_svc;
ALTER DEFAULT PRIVILEGES IN SCHEMA _inbox   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO helpdesk_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'location_svc') THEN
    CREATE ROLE location_svc WITH LOGIN PASSWORD 'location_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_location OWNER location_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_location') \gexec
\connect civitas_location
CREATE SCHEMA IF NOT EXISTS location AUTHORIZATION location_svc;
CREATE SCHEMA IF NOT EXISTS _outbox    AUTHORIZATION location_svc;
CREATE SCHEMA IF NOT EXISTS _inbox     AUTHORIZATION location_svc;

-- knowledge, workflow, analytics services

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'knowledge_svc') THEN
    CREATE ROLE knowledge_svc WITH LOGIN PASSWORD 'knowledge_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_knowledge OWNER knowledge_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_knowledge') \gexec
\connect civitas_knowledge
CREATE SCHEMA IF NOT EXISTS knowledge AUTHORIZATION knowledge_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION knowledge_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION knowledge_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'workflow_svc') THEN
    CREATE ROLE workflow_svc WITH LOGIN PASSWORD 'workflow_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_workflow OWNER workflow_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_workflow') \gexec
\connect civitas_workflow
CREATE SCHEMA IF NOT EXISTS workflow AUTHORIZATION workflow_svc;
CREATE SCHEMA IF NOT EXISTS _outbox    AUTHORIZATION workflow_svc;
CREATE SCHEMA IF NOT EXISTS _inbox     AUTHORIZATION workflow_svc;

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'analytics_svc') THEN
    CREATE ROLE analytics_svc WITH LOGIN PASSWORD 'analytics_dev_pw';
  END IF;
END $$;
SELECT 'CREATE DATABASE civitas_analytics OWNER analytics_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_analytics') \gexec
\connect civitas_analytics
CREATE SCHEMA IF NOT EXISTS analytics AUTHORIZATION analytics_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION analytics_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION analytics_svc;
