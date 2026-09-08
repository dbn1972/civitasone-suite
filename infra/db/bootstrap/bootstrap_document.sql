-- bootstrap_document.sql
--
-- Purpose: create the document_svc role + civitas_document database.
--
-- DEFECT THIS FIXES (COMP-003): document-service has a fully implemented
-- Fastify app (src/app.ts), four real modules (files/folders/workflow/
-- sharing — routes, commands, consumers, drizzle schema) and is already
-- wired into the gateway registry (routes /api/v1/documents AND
-- /api/v1/eoffice to it, gateway-service/src/registry.ts) and into
-- ecosystem.config.js (svc("document", 3049, "document_svc",
-- "civitas_document")) -- but no bootstrap file anywhere ever created
-- document_svc or civitas_document, no migrations/ directory existed, and
-- it was never added to bootstrap-postgres.sh's SERVICE_DBS map. All of
-- services/document-service/src (~1400 lines) was added in commit
-- 8d542ee0 (2026-08-13) alongside an unrelated HRMS PR, and the DB/CI
-- plumbing was simply never finished afterward -- the same "declared but
-- never provisioned" gap REL-006 covers for field-service/
-- recommendation-service. Confirmed absent by grepping civitas_document/
-- document_svc across every infra/db/bootstrap/*.sql file before adding
-- this one.
--
-- Schema creation is NOT done here: services/document-service/migrations/
-- 0001_document_foundation.sql creates the `document` schema itself; grants
-- to document_svc are guarded on the role already existing -- it only needs
-- a database + login role to connect with.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'document_svc') THEN
    CREATE ROLE document_svc WITH LOGIN PASSWORD 'document_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_document OWNER document_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_document') \gexec
