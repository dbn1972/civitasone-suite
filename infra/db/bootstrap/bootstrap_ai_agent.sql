-- bootstrap_ai_agent.sql
--
-- Purpose: create the ai_agent_svc role + civitas_ai_agent database.
--
-- DEFECT THIS FIXES: ai-agent-service has real migrations
-- (services/ai-agent-service/migrations/0001_ai_agent_foundation.sql,
-- 0002_ai_agent_sprint2.sql, 0003_ai_agent_chat_handoff.sql -- which create
-- the ai_agent schema, _outbox/_inbox schemas, and grant on them themselves)
-- and is wired into scripts/dev/provision-platform-roles.mjs (role
-- ai_agent_svc, db civitas_ai_agent, schema ai_agent), ecosystem.config.js
-- (worker + svc entries) and services/ai-agent-service/vitest.config.ts's own
-- DATABASE_URL default (postgres://ai_agent_svc:ai_agent_dev_pw@localhost:
-- 5435/civitas_ai_agent) -- but no bootstrap file here ever created
-- ai_agent_svc or civitas_ai_agent, and ai-agent-service was never added to
-- bootstrap-postgres.sh's SERVICE_DBS map. So on a fresh CI Postgres, every
-- ai-agent-service migration fails to even authenticate (role does not
-- exist, indistinguishable from a wrong password), and ai-agent-service's
-- tests can never run against a real database in CI. Confirmed absent by
-- grepping civitas_ai_agent/ai_agent_svc across every
-- infra/db/bootstrap/*.sql file before adding this one -- same class of gap
-- bootstrap_shop.sql and bootstrap_sewerage.sql fixed for their services.
--
-- Password matches provision-platform-roles.mjs's defaultPassword for
-- ai_agent_svc ("ai_agent_dev_pw") and the SERVICE_DBS migration loop's own
-- {role}_svc -> {role}_dev_pw convention, so both dev tooling and CI agree.
--
-- Schema creation is NOT done here: services/ai-agent-service/migrations/
-- 0001_ai_agent_foundation.sql already does CREATE SCHEMA IF NOT EXISTS
-- ai_agent (plus _outbox/_inbox with explicit grants) itself -- it only
-- needs a database it can connect to in order to do that.
--
-- Idempotent; safe to re-run.

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ai_agent_svc') THEN
    CREATE ROLE ai_agent_svc WITH LOGIN PASSWORD 'ai_agent_dev_pw';
  END IF;
END $$;

SELECT 'CREATE DATABASE civitas_ai_agent OWNER ai_agent_svc'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'civitas_ai_agent') \gexec
