-- admin-service migration 0050 — Module-gating enforcement mode + grandfather
-- backfill (FF-03, ST-M01-02).
--
-- Decisions built on (APPROVED, M00/DECISIONS.md Approval log):
--   D-ST-24  Option 1 — the minimal FF-03 safety apparatus is in scope for
--            ST-M01-02: a grandfather backfill (every existing tenant entitled
--            to exactly what it can reach today, applied BEFORE any enforcement)
--            plus a per-tenant off/shadow/enforce mode defaulting to `off`.
--   D-ST-23  Workforce Core / SmartTransfer are their own SKUs; the standalone
--            profile (migration 0049) starts fail-closed.
-- Spec: SMARTTRANSFER-MASTER-SPEC-v3 §3 (product modes), §14 (security —
--       fail-closed module gating with a single source of truth).
--
-- This migration is PURELY the safety apparatus the gateway reads; it does NOT
-- itself change any request's outcome. The gateway module-guard
-- (services/gateway-service/src/module-guard.ts) reads the per-tenant mode
-- through the composition internal projection and only fails closed when a
-- tenant is explicitly `enforce`. Default `off` preserves the gateway-service
-- #986 legacy-tenant safeguard verbatim.
--
-- Idempotent: CREATE ... IF NOT EXISTS, ON CONFLICT DO NOTHING on the DML, and
-- an ADD CONSTRAINT guarded by a catalog check. Safe to re-run (bootstrap runs
-- every migration twice). No demo tenant rows are invented — the backfill only
-- mirrors entitlements a tenant ALREADY has via admin.module_configs.

-- ── 1. per-tenant enforcement mode (TENANT data, FORCE-RLS) ────────────────
-- Resolution order the gateway applies (see module-guard.ts):
--   1. an explicit row here wins (off | shadow | enforce);
--   2. else a tenant whose composition profile is `smarttransfer_standalone`
--      is treated as `enforce` (fail-closed from day one, D-ST-23/24);
--   3. else `off` (every pre-existing tenant — no behaviour change).
-- Only `enforce` ever blocks. `shadow` logs/metrics a would-deny but allows.
CREATE TABLE IF NOT EXISTS composition.tenant_enforcement_mode (
  tenant_id   uuid PRIMARY KEY,
  mode        text NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','enforce')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid NOT NULL
);

-- RLS mirrors 0005/0025 tenant_isolation. current_tenant_id() is created by
-- 0005 (always applied first); not redefined here (least-privilege admin_svc
-- role is not its owner).
ALTER TABLE composition.tenant_enforcement_mode ENABLE ROW LEVEL SECURITY;
ALTER TABLE composition.tenant_enforcement_mode FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON composition.tenant_enforcement_mode;
CREATE POLICY tenant_isolation ON composition.tenant_enforcement_mode
  USING (tenant_id = current_tenant_id());

-- Leading-tenant index (house rule: FORCE RLS + tenant index). The PK already
-- leads with tenant_id, but an explicit named index documents the intent and
-- matches the convention used by the other composition tenant tables.
CREATE INDEX IF NOT EXISTS tenant_enforcement_mode_tenant_idx
  ON composition.tenant_enforcement_mode (tenant_id);

-- ── 2. allow a 'grandfather' entitlement source ───────────────────────────
-- tenant_entitlement.source was CHECK (source IN ('user','dep','core')) in
-- 0025. Grandfather rows are a distinct, auditable fourth source so they can be
-- told apart from a tenant's own picks (and migrated/removed later without
-- touching user selections). Guarded so a re-run does not error on the already-
-- replaced constraint.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'tenant_entitlement_source_check'
      AND conrelid = 'composition.tenant_entitlement'::regclass
  ) THEN
    ALTER TABLE composition.tenant_entitlement
      DROP CONSTRAINT tenant_entitlement_source_check;
  END IF;
  ALTER TABLE composition.tenant_entitlement
    ADD CONSTRAINT tenant_entitlement_source_check
    CHECK (source IN ('user','dep','core','grandfather'));
END $$;

-- ── 3. grandfather backfill (DML on a FORCE-RLS table) ─────────────────────
-- Goal (D-ST-24 item 1): every existing tenant is entitled to EXACTLY what it
-- can reach today, applied BEFORE any enforcement flips on. "What it can reach
-- today" = the legacy enabled gateway module-keys in admin.module_configs
-- (what the pre-composition gateway guard allows). We translate each enabled
-- gateway route-key back to the composition module-id(s) that project to it
-- (the inverse of composition/gateway-map.ts COMPOSITION_TO_GATEWAY_KEYS) and
-- insert them as source='grandfather'. We insert ONLY for tenants that have no
-- composition entitlement yet (never onboarded via composition) — a tenant that
-- already composed its modules keeps its own, richer, user/dep/core set.
--
-- NO FORCE … FORCE: this migration runs as the table OWNER (admin_svc), which
-- is NOBYPASSRLS, so FORCE RLS applies to it too. The backfill is a cross-
-- tenant statement (it reads every tenant's config.admin_module_configs and
-- writes every tenant's composition.tenant_entitlement) with no app.tenant_id
-- GUC set, so BOTH the source read and the target write would otherwise see
-- zero rows under FORCE. We drop FORCE on both tables for the single statement
-- and restore it immediately — the sanctioned backfill idiom (house rule §4.3).
-- The statement is itself tenant-safe: every inserted row carries the
-- module_configs row's own tenant_id, so no row crosses a tenant boundary.
ALTER TABLE composition.tenant_entitlement NO FORCE ROW LEVEL SECURITY;
ALTER TABLE config.admin_module_configs    NO FORCE ROW LEVEL SECURITY;

-- Inverse projection, kept in lock-step with composition/gateway-map.ts. Only
-- the gateway route-keys that a legacy tenant could actually have enabled are
-- listed; each maps to the composition module-id(s) that project onto it. The
-- platform/core kernel (identity/org/config/workflow/audit) is always resolved
-- by the composition resolver, so it is intentionally NOT backfilled here.
WITH gateway_key_to_module(gateway_key, module_id) AS (
  VALUES
    ('workflow','workflow'),
    ('hrms','employee'), ('hrms','attendance'), ('hrms','leave'),
    ('hrms','recruitment'), ('hrms','appraisal'), ('hrms','career'), ('hrms','ess'),
    ('establishment','employee'),
    ('reports','ess'), ('reports','analytics'),
    ('payroll','payroll'), ('payroll','loans'), ('payroll','benefits'), ('payroll','separation'),
    ('finance','finance'), ('finance','budget'), ('finance','treasury'), ('finance','revenue'),
    ('procurement','procurement'),
    ('contracts','contract'),
    ('inventory','inventory'), ('stock','inventory'),
    ('assets','asset'),
    ('projects','works'), ('projects','project'),
    ('grants','grant'),
    ('citizen','citizen'),
    ('crm','crm'),
    ('helpdesk','helpdesk'),
    ('knowledge','knowledge'),
    ('legal','legal'),
    ('inspection','inspection'),
    ('analytics','analytics'),
    ('shop','shop'), ('trade','trade'), ('building','building'), ('fire','fire'),
    ('advertisement','advertisement'), ('vendor','vendor'), ('roadcut','roadcut'),
    ('event','event'), ('refund','refund'), ('sewerage','sewerage'), ('swm','swm'),
    ('drainage','drainage'), ('parks','parks'), ('animal','animal'),
    ('crematorium','crematorium'), ('parking','parking'), ('market','market')
),
-- Tenants that already have ANY composition entitlement are left untouched.
composed_tenants AS (
  SELECT DISTINCT tenant_id FROM composition.tenant_entitlement
),
-- The legacy enabled gateway-keys per tenant, translated to composition ids
-- that actually exist in the registry (so the FK holds).
legacy_entitlements AS (
  SELECT DISTINCT mc.tenant_id, k.module_id
  FROM config.admin_module_configs mc
  JOIN gateway_key_to_module k ON k.gateway_key = mc.module_key
  JOIN composition.module_registry r ON r.id = k.module_id
  WHERE mc.enabled = true
    AND mc.tenant_id NOT IN (SELECT tenant_id FROM composed_tenants)
)
INSERT INTO composition.tenant_entitlement (tenant_id, module_id, source, created_by)
SELECT tenant_id, module_id, 'grandfather',
       '00000000-0000-0000-0000-000000000000'::uuid
FROM legacy_entitlements
ON CONFLICT (tenant_id, module_id) DO NOTHING;

ALTER TABLE config.admin_module_configs    FORCE ROW LEVEL SECURITY;
ALTER TABLE composition.tenant_entitlement FORCE ROW LEVEL SECURITY;
