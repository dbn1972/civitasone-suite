-- Bootstrap for contract-service (run once as civitas_admin / postgres superuser)
-- Creates the role, database, and L2 schemas.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'contract_svc') THEN
    CREATE ROLE contract_svc WITH LOGIN PASSWORD 'contract_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_contract OWNER contract_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_contract') \gexec

\connect civitas_contract

CREATE SCHEMA IF NOT EXISTS contracts   AUTHORIZATION contract_svc;
CREATE SCHEMA IF NOT EXISTS rate        AUTHORIZATION contract_svc;
CREATE SCHEMA IF NOT EXISTS _outbox     AUTHORIZATION contract_svc;
CREATE SCHEMA IF NOT EXISTS _inbox      AUTHORIZATION contract_svc;

GRANT ALL ON SCHEMA contracts  TO contract_svc;
GRANT ALL ON SCHEMA rate       TO contract_svc;
GRANT ALL ON SCHEMA _outbox    TO contract_svc;
GRANT ALL ON SCHEMA _inbox     TO contract_svc;
