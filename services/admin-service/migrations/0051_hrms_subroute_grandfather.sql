-- admin-service migration 0051 — HRMS sub-route split grandfather backfill
-- (FF-03, ST-M01-04b).
--
-- Decisions built on (APPROVED, M00/DECISIONS.md Approval log):
--   D-ST-23  Workforce Core is a licensable hrms-service profile; SmartTransfer
--            is its own SKU. The gateway must stop letting the single `hrms`
--            key unlock leave / attendance / recruitment / payroll-facing / …
--   D-ST-24  Per-tenant off/shadow/enforce modes + grandfather backfill
--            (migration 0050). This migration EXTENDS that backfill for the
--            sub-route split so no existing tenant loses a surface it can reach
--            today, BEFORE any enforcement flips on.
-- Spec: SMARTTRANSFER-MASTER-SPEC-v3 §3 (product modes / standalone SKU), §14
--       (security — fail-closed module gating, single source of truth).
--
-- WHY (the regression this prevents)
-- ----------------------------------
-- Before ST-M01-04b the gateway module-guard resolved the ENTIRE hrms-service
-- surface to one key, `hrms`, and every HR composition module
-- (employee / attendance / leave / recruitment / appraisal / career / ess)
-- projected to it (composition/gateway-map.ts). So a tenant entitled to the
-- base HRIS module `employee` could reach `/v1/hrms/leave/*`,
-- `/v1/hrms/attendance/*`, `/v1/hrms/recruitment/*`, … at the gateway even
-- without the separately-licensable `leave` / `attendance` / `recruitment`
-- composition modules.
--
-- ST-M01-04b makes the guard PATH-AWARE: each non-core prefix now resolves to
-- its own key (hrms-leave / hrms-attendance / hrms-recruitment / hrms-appraisal
-- / hrms-self-service, …) and the HR composition modules project 1:1 onto them
-- (gateway-map.ts). `employee` still projects to `workforce_core` + the base-
-- HRIS sub-keys (training/social/disciplinary/… that are NOT separately
-- licensable), but it NO LONGER projects to the licensable sibling keys. So a
-- tenant that today has `employee` but not the explicit `leave` module would,
-- after the split, be 403'd on `/v1/hrms/leave/*` even in `off` mode (a KNOWN
-- allow-list that omits the resolved key 403s in every mode — the pre-FF-03
-- contract). That is a surface it CAN reach today, so we must grandfather it.
--
-- WHAT (the grant)
-- ----------------
-- For every tenant currently entitled to the base HRIS module `employee`
-- (source user/dep/core/grandfather — i.e. it reaches the `hrms` surface today),
-- also entitle it to the licensable HR sibling modules it is missing:
--   attendance, leave, recruitment, appraisal, career, ess
-- as source='grandfather'. Those project to the new sub-keys, so the tenant
-- keeps the exact surface it had. We DELIBERATELY do NOT touch tenants that have
-- `workforce_core` but not `employee` (the standalone SKU) — their whole point
-- is to reach ONLY the core surface, so they must NOT be grandfathered onto the
-- non-core sub-keys. (A standalone tenant's old `hrms` key came solely from
-- `workforce_core`→`hrms`; the split's purpose is to remove exactly that reach.)
--
-- Migration 0050 already backfills legacy `config.admin_module_configs` tenants
-- (those never onboarded via composition) with the full HR id set via its
-- inverse projection; this migration closes the remaining gap: tenants that
-- ALREADY have a composition entitlement (so 0050's `composed_tenants` guard
-- skipped them) and carry `employee`. Running after 0050 it is also a safety
-- net for the legacy set.
--
-- Idempotent: ON CONFLICT DO NOTHING; the `source='grandfather'` label lets
-- these rows be told apart from a tenant's own picks and migrated/removed later
-- without touching user selections. Safe to re-run (bootstrap runs every
-- migration twice).
--
-- NO FORCE … FORCE: this migration runs as the table OWNER (admin_svc), which
-- is NOBYPASSRLS, so FORCE RLS applies to it too. The backfill is a cross-tenant
-- statement (it reads and writes every tenant's composition.tenant_entitlement)
-- with no app.tenant_id GUC set, so under FORCE RLS both the read and the write
-- would see zero rows. We drop FORCE for the single statement and restore it
-- immediately — the sanctioned backfill idiom (house rule §4.3). The statement
-- is itself tenant-safe: every inserted row carries the SOURCE row's own
-- tenant_id, so no row crosses a tenant boundary.

ALTER TABLE composition.tenant_entitlement NO FORCE ROW LEVEL SECURITY;

WITH
-- Every tenant that holds the base HRIS `employee` module today (any source).
-- These are exactly the tenants that reach the full HRMS surface at the gateway
-- under the pre-split projection and must keep it after the split.
employee_tenants AS (
  SELECT DISTINCT tenant_id
  FROM composition.tenant_entitlement
  WHERE module_id = 'employee'
),
-- The licensable HR sibling modules the split peels off into their own gateway
-- sub-keys. Each must exist in the registry so the (tenant_id, module_id) FK
-- holds; a JOIN against module_registry enforces that.
hr_sibling(module_id) AS (
  VALUES ('attendance'),('leave'),('recruitment'),('appraisal'),('career'),('ess')
),
to_grant AS (
  SELECT t.tenant_id, s.module_id
  FROM employee_tenants t
  CROSS JOIN hr_sibling s
  JOIN composition.module_registry r ON r.id = s.module_id
)
INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by)
SELECT tenant_id, module_id, 'grandfather',
       '00000000-0000-0000-0000-000000000000'::uuid
FROM to_grant
ON CONFLICT (tenant_id, module_id) DO NOTHING;

ALTER TABLE composition.tenant_entitlement FORCE ROW LEVEL SECURITY;
