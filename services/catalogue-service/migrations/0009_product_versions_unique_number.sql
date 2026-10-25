-- 0009_product_versions_unique_number.sql
-- CLOS3-S4-05: catalogue.product_versions had no uniqueness on (tenant_id, product_id,
-- version_number); concurrent openProductVersion commands (number computed by the route from a
-- stale read) produced duplicate numbers. The consumer now serialises opens per product and
-- allocates max+1; this index is the database-level guarantee behind it.
-- Any existing duplicate keeps the earliest row (created_at, id) and the later ones are moved to
-- max+1, max+2, ... for that product so no version is deleted and no status changes.
-- DML on a FORCE-RLS table from an owner-run migration needs the NO FORCE / FORCE wrap (no
-- app.tenant_id GUC here); FORCE is restored unconditionally.
-- Idempotent. Rollback: DROP INDEX IF EXISTS catalogue.uq_product_versions_tenant_product_number;
-- (renumbered duplicates are not restored).
-- Affected services: catalogue-service

SET lock_timeout = '5s';

ALTER TABLE catalogue.product_versions NO FORCE ROW LEVEL SECURITY;

WITH ranked AS (
  SELECT id, tenant_id, product_id, created_at,
         row_number() OVER (PARTITION BY tenant_id, product_id, version_number ORDER BY created_at, id) AS rn
    FROM catalogue.product_versions
), dups AS (
  SELECT id, tenant_id, product_id,
         row_number() OVER (PARTITION BY tenant_id, product_id ORDER BY created_at, id) AS k
    FROM ranked WHERE rn > 1
), mx AS (
  SELECT tenant_id, product_id, max(version_number) AS m
    FROM catalogue.product_versions GROUP BY tenant_id, product_id
)
UPDATE catalogue.product_versions v
   SET version_number = mx.m + dups.k
  FROM dups JOIN mx ON mx.tenant_id = dups.tenant_id AND mx.product_id = dups.product_id
 WHERE v.id = dups.id;

ALTER TABLE catalogue.product_versions FORCE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS uq_product_versions_tenant_product_number
  ON catalogue.product_versions (tenant_id, product_id, version_number);
