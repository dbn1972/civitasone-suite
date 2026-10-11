-- admin-service migration 0049 — SmartTransfer OS catalogue & licensing.
--
-- Extends the composition catalogue (0025 base, 0026 full-ERP re-seed) so the
-- platform can EXPRESS a "Workforce Core + SmartTransfer" tenant — the FF-03
-- precondition the standalone feasibility study calls out (M00 standalone
-- report §2, §5 item 2). Scope is the CATALOGUE only: this migration makes the
-- composition able to name and resolve the standalone module set. It does NOT
-- change gateway enforcement semantics (that is ST-M01-02, blocked on an owner
-- decision) and it does NOT add fail-closed behaviour.
--
-- Decisions built on (all APPROVED, M00/DECISIONS.md Approval log 2026-10-09):
--   D-ST-23 (a) — Workforce Core is a separately licensable hrms-service
--                 profile; SmartTransfer is its own SKU.
--   D-ST-01       Post + effective-dated Occupancy owned by Workforce Core.
--   D-ST-02       Office/department hierarchy owned by Workforce Core.
--   D-ST-03       Cadre master owned by Workforce Core.
-- Spec: SMARTTRANSFER-MASTER-SPEC-v3 §3 (product modes), §11 (module
--       integration — SmartTransfer deps workflow + audit).
--
-- Adds, to the GLOBAL reference catalogue (no tenant_id → no RLS, same as the
-- rows seeded by 0025/0026; see those files' header rationale and §2 of this
-- repo's docs/DATABASE-SCHEMA.md):
--   • module_registry rows: `workforce_core` (deps org, config) and
--     `smarttransfer` (deps workforce_core, workflow, audit), cluster
--     `workforce`.
--   • module_bundle `smarttransfer_standalone` (the one-click standalone SKU).
--   • org_profile `smarttransfer_standalone` whose default_modules is exactly
--     `{smarttransfer}` — the resolver pulls workforce_core + the core kernel
--     and NOTHING ELSE, so leave / payroll / recruitment are never entitled.
--
-- Idempotent: ON CONFLICT DO UPDATE on every seed. No tenant rows inserted.

-- ── 1. module registry rows ───────────────────────────────────────────────
-- workforce_core is layer 1 (a domain master, like `employee`), is_core=false
-- (it is licensable, NOT part of the always-on kernel), hard-deps org+config.
-- smarttransfer is layer 2 and hard-deps workforce_core + workflow + audit.
-- `workflow` and `audit` are already layer-0 core modules (0025/0026), so a
-- standalone tenant gets them via the kernel; naming them as hard deps keeps
-- the dependency graph explicit and lets the resolver's cycle/closure checks
-- cover SmartTransfer too.
INSERT INTO composition.module_registry (id, name, layer, is_core, cluster, hard_deps, soft_deps, screens, sort_order) VALUES
  ('workforce_core', 'Workforce Core',  1, false, 'workforce', ARRAY['org','config'],                  '{}',             ARRAY['Employee Basics','Office Hierarchy','Cadre','Sanctioned Post & Occupancy','Posting Ledger'], 116),
  ('smarttransfer',  'SmartTransfer OS', 2, false, 'workforce', ARRAY['workforce_core','workflow','audit'], ARRAY['employee'], ARRAY['Transfer Cycle','Eligibility','Preferences','Allocation','Movement Orders','Relieving & Joining'], 118)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, layer = EXCLUDED.layer, is_core = EXCLUDED.is_core, cluster = EXCLUDED.cluster,
  hard_deps = EXCLUDED.hard_deps, soft_deps = EXCLUDED.soft_deps,
  screens = EXCLUDED.screens, sort_order = EXCLUDED.sort_order;

-- ── 2. standalone bundle (one-click SKU) ───────────────────────────────────
-- The bundle enables `smarttransfer`; the resolver pulls workforce_core + core.
INSERT INTO composition.module_bundle (code, label, subtitle, module_ids, sort_order) VALUES
  ('smarttransfer_standalone', 'SmartTransfer OS (standalone)', 'Workforce movement & allocation without full HRMS', ARRAY['smarttransfer'], 90)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label, subtitle = EXCLUDED.subtitle,
  module_ids = EXCLUDED.module_ids, sort_order = EXCLUDED.sort_order;

-- ── 3. standalone org profile ──────────────────────────────────────────────
-- default_modules is EXACTLY {smarttransfer}. resolveComposition() folds in
-- workforce_core (hard dep) + the core kernel and nothing else: no employee
-- (non-core HRIS), no leave, no payroll, no recruitment. This is what lets a
-- tenant be provisioned as the standalone SKU with a minimal footprint.
-- rule_packs/terminology mirror the govt vocabulary (transfers are a
-- government-sector concern) but carry none of the HR/finance packs.
INSERT INTO composition.org_profile (code, label, subtitle, rule_packs, terminology, statutory, reservation, default_modules, sort_order) VALUES
  ('smarttransfer_standalone', 'SmartTransfer OS (standalone)', 'Workforce movement engine, no full HRMS',
    '{"transfer":"state_rules"}'::jsonb,
    '{"post":"Sanctioned post","unit":"Office","strength":"Sanctioned strength","movement":"Transfer / Posting"}'::jsonb,
    '{}'::jsonb,
    false,
    ARRAY['smarttransfer'],
    40)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label, subtitle = EXCLUDED.subtitle, rule_packs = EXCLUDED.rule_packs,
  terminology = EXCLUDED.terminology, statutory = EXCLUDED.statutory,
  reservation = EXCLUDED.reservation, default_modules = EXCLUDED.default_modules,
  sort_order = EXCLUDED.sort_order;
