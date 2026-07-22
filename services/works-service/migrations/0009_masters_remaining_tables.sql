-- Purpose: Create remaining WAMIS master tables defined in modules/masters/schema.ts
--          (publication_levels, repair_types, schemes, scopes, tender_types,
--           user_departments, contractor_classes, issue_types, issue_description_types,
--           assets, work_description_types, sr_items)
-- Rollback: DROP TABLE IF EXISTS works.sr_items, works.work_description_types,
--           works.assets, works.issue_description_types, works.issue_types,
--           works.contractor_classes, works.user_departments, works.tender_types,
--           works.scopes, works.schemes, works.repair_types, works.publication_levels;
-- Affected services: works-service

SET lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS works.publication_levels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.repair_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  program_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.schemes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  sponsor varchar(256),
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.scopes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_type_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  unit varchar(64) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.tender_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  rate_type varchar(64),
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.user_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  demand_number varchar(64),
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.contractor_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  description varchar(512),
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.issue_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.issue_description_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  issue_type_id uuid NOT NULL,
  name varchar(256) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  code varchar(64) NOT NULL,
  name varchar(256) NOT NULL,
  type varchar(64),
  district varchar(128),
  taluka varchar(128),
  chainage varchar(64),
  cost bigint,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.work_description_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  work_type_id uuid NOT NULL,
  keyword varchar(256) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS works.sr_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  zone varchar(64) NOT NULL,
  sr_year varchar(16) NOT NULL,
  item_code varchar(64) NOT NULL,
  description varchar(1024) NOT NULL,
  unit varchar(64) NOT NULL,
  rate bigint NOT NULL,
  active boolean NOT NULL DEFAULT true,
  version int NOT NULL DEFAULT 1
);

-- Indexes for tenant scoping (non-blocking)
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_publication_levels_tenant ON works.publication_levels (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_repair_types_tenant ON works.repair_types (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_schemes_tenant ON works.schemes (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_scopes_tenant ON works.scopes (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_tender_types_tenant ON works.tender_types (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_departments_tenant ON works.user_departments (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_contractor_classes_tenant ON works.contractor_classes (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_types_tenant ON works.issue_types (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_issue_description_types_tenant ON works.issue_description_types (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_assets_tenant ON works.assets (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_work_description_types_tenant ON works.work_description_types (tenant_id);
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sr_items_tenant ON works.sr_items (tenant_id);
