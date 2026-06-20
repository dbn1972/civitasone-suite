-- Keycloak database and role bootstrap.
-- Run once as civitas_admin (the Postgres superuser for this cluster).
-- Applied before starting the Keycloak container.
--
-- Usage:
--   PGPASSWORD=civitas_dev_pw psql -h localhost -p 5435 -U civitas_admin \
--     -f infra/db/bootstrap/keycloak_bootstrap.sql

-- Role
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'keycloak_svc') THEN
    CREATE ROLE keycloak_svc WITH LOGIN PASSWORD 'keycloak_dev_pw';
  END IF;
END$$;

-- Database
SELECT 'CREATE DATABASE keycloak OWNER keycloak_svc'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec

GRANT ALL PRIVILEGES ON DATABASE keycloak TO keycloak_svc;
