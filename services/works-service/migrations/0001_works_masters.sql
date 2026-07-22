-- Purpose: Create WAMIS master tables (17 entities) in works schema
-- Rollback: DROP SCHEMA works CASCADE; (DANGEROUS — requires approval)
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE SCHEMA IF NOT EXISTS works;

CREATE TABLE IF NOT EXISTS works.authorities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  code varchar(64) NOT NULL,
  level varchar(64),
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.work_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  code varchar(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.work_sub_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_type_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  code varchar(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.proposer_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.programs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);
