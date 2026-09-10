#!/usr/bin/env node
/**
 * seed-platform-admin-rbac.mjs — COMP-013 backing data.
 *
 * platform-admin/roles used to render a Roles & Permissions matrix built
 * from a hardcoded ROLES list and a hardcoded DEFAULTS module x action
 * baseline (apps/web/.../platform-admin/roles/RolePermissionsMatrix.tsx,
 * pre-fix). The page is now wired to identity-service's real RBAC store
 * (rbac.roles / rbac.permissions / rbac.role_permissions), the same tables
 * and the same admin-service routes COMP-004 wired for admin/roles. But
 * that store starts EMPTY for a tenant -- nothing in this fleet has ever
 * created the 9 platform roles or the 8-module x 6-action permission
 * catalogue this UI's grid is keyed on. Without this seed the page is
 * honestly wired but shows nothing to toggle ("No permissions are defined
 * for this tenant yet").
 *
 * This script creates, per tenant:
 *   - the 9 roles the old UI hardcoded (super_admin / platform_admin are
 *     is_system = true, matching admin/roles' existing "system role,
 *     read-only" convention; identical treatment to how COMP-004 already
 *     represents those two role keys as real DB rows)
 *   - the 48 permissions (8 modules x 6 actions), key format "<module>.<action>",
 *     matching apps/web's RolePermissionsMatrix which derives its module/
 *     action grid axes from real permission keys of this exact shape
 *   - role_permissions grants reproducing the SAME baseline the old
 *     fabricated DEFAULTS constant displayed, now as real, toggleable rows
 *     instead of a hardcoded frontend fixture
 *
 * Writes directly to rbac.* via psql (same technique scripts/demo/seed-demo.mjs
 * already uses for rbac.roles/rbac.role_assignments) rather than the async
 * command API (POST /identity/rbac/roles etc.), because that API's grant
 * path enforces anti-self-escalation (assertCanConfer: the caller must
 * already hold a permission before conferring it) -- a real safeguard for
 * an interactive admin, but a bootstrap chicken-and-egg for a from-empty
 * seed. Idempotent: every insert is ON CONFLICT DO NOTHING against this
 * schema's existing (tenant_id, key) / (tenant_id, role_id, permission_id)
 * unique indexes (migrations/0009_rbac.sql), safe to re-run.
 *
 * Usage:
 *   node scripts/seed-platform-admin-rbac.mjs
 *   TENANT_IDS=<uuid>,<uuid> node scripts/seed-platform-admin-rbac.mjs
 *
 * Env overrides:
 *   PG_CONTAINER  (default civitasone-postgres)  docker container running postgres
 *   TENANT_IDS    (default the two seed-demo.mjs demo tenants)  comma-separated tenant UUIDs
 */
import { execSync } from "node:child_process";

const PG_CONTAINER = process.env.PG_CONTAINER || "civitasone-postgres";
const ACTOR = "00000000-0000-0000-0000-000000000099"; // seed actor, same convention as seed-demo.mjs / seed-rbac-policy-store.ts
const TENANTS = (process.env.TENANT_IDS || "00000000-0000-0000-0000-000000000001,00000000-0000-0000-0000-000000000002")
  .split(",").map((s) => s.trim()).filter(Boolean);

const MODULES = ["hr", "payroll", "finance", "procurement", "leave", "audit", "reports", "settings"];
const ACTIONS = ["read", "create", "update", "delete", "submit", "approve"];

// Role catalogue: [key, name, description, isSystem] -- the exact 9 roles
// the pre-fix UI hardcoded as its ROLES constant.
const ROLES = [
  ["super_admin", "Super Admin", "Full platform access", true],
  ["platform_admin", "Platform Admin", "Infrastructure & billing", true],
  ["tenant_admin", "Tenant Admin", "Tenant configuration", false],
  ["hr_admin", "HR Admin", "Full HR module access", false],
  ["payroll_admin", "Payroll Admin", "Full payroll access", false],
  ["finance_admin", "Finance Admin", "Finance read + reports", false],
  ["audit_admin", "Audit Admin", "Read-only audit access", false],
  ["dept_head", "Dept Head", "Own department only", false],
  ["hr_staff", "HR Staff", "Day-to-day HR operations", false],
];

// Grant baseline: reproduces the pre-fix UI's hardcoded DEFAULTS constant --
// same roles, same modules, same actions, same grants -- now seeded as real
// role_permissions rows instead of a frontend fixture.
const DEFAULTS = {
  super_admin: Object.fromEntries(MODULES.map((m) => [m, [...ACTIONS]])),
  platform_admin: { hr: ["read"], payroll: ["read"], finance: ["read"], procurement: ["read"], leave: ["read"], audit: ["read", "create", "update", "delete"], reports: ["read", "create"], settings: ["read", "create", "update", "delete"] },
  tenant_admin: { hr: ["read", "create", "update"], payroll: ["read"], finance: ["read"], leave: ["read", "create", "update", "approve"], audit: ["read"], reports: ["read", "create"], settings: ["read", "create", "update"] },
  hr_admin: { hr: ["read", "create", "update", "delete", "submit"], payroll: ["read"], leave: ["read", "create", "update", "approve"], audit: ["read"], reports: ["read", "create"] },
  payroll_admin: { hr: ["read"], payroll: ["read", "create", "update", "submit"], finance: ["read"], leave: ["read"], audit: ["read"], reports: ["read", "create"] },
  finance_admin: { hr: ["read"], payroll: ["read", "approve"], finance: ["read", "create", "update", "submit", "approve"], procurement: ["read", "approve"], leave: ["read"], audit: ["read"], reports: ["read", "create"] },
  audit_admin: { hr: ["read"], payroll: ["read"], finance: ["read"], procurement: ["read"], leave: ["read"], audit: ["read", "create", "update", "delete", "approve"], reports: ["read", "create"] },
  dept_head: { hr: ["read"], leave: ["read", "approve"], audit: ["read"], reports: ["read"] },
  hr_staff: { hr: ["read", "create", "update"], leave: ["read", "create"], audit: ["read"], reports: ["read"] },
};

function titleCase(action) {
  return action.charAt(0).toUpperCase() + action.slice(1);
}
function permName(mod, action) {
  return `${titleCase(action)} ${mod}`;
}

function sqlLit(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

let errors = 0;
function psql(sql) {
  return execSync(`docker exec -i ${PG_CONTAINER} psql -U civitas_admin -d civitas_identity -v ON_ERROR_STOP=1 -tA`, {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function step(label, sql) {
  try {
    psql(sql);
    console.log(`  ok ${label}`);
  } catch (err) {
    const msg = ((err.stderr ?? "") + (err.stdout ?? "")).toString().trim();
    console.error(`  FAIL ${label}: ${msg.slice(0, 500)}`);
    errors++;
  }
}

for (const tenant of TENANTS) {
  console.log(`\n=== tenant ${tenant} ===`);

  const roleRows = ROLES.map(([key, name, desc, isSystem]) =>
    `(${sqlLit(tenant)}, ${sqlLit(key)}, ${sqlLit(name)}, ${sqlLit(desc)}, ${isSystem}, now(), now(), ${sqlLit(ACTOR)}, ${sqlLit(ACTOR)}, 1)`,
  ).join(",\n    ");

  const permRows = [];
  for (const mod of MODULES) {
    for (const action of ACTIONS) {
      permRows.push(`(${sqlLit(tenant)}, ${sqlLit(`${mod}.${action}`)}, ${sqlLit(permName(mod, action))}, now(), now(), ${sqlLit(ACTOR)}, ${sqlLit(ACTOR)}, 1)`);
    }
  }

  step(`rbac.roles (${ROLES.length} roles)`, `
BEGIN;
SELECT set_config('app.tenant_id', ${sqlLit(tenant)}, true);
INSERT INTO rbac.roles (tenant_id, key, name, description, is_system, created_at, updated_at, created_by, updated_by, version)
  VALUES
    ${roleRows}
  ON CONFLICT (tenant_id, key) DO NOTHING;
COMMIT;
`);

  step(`rbac.permissions (${permRows.length} permissions)`, `
BEGIN;
SELECT set_config('app.tenant_id', ${sqlLit(tenant)}, true);
INSERT INTO rbac.permissions (tenant_id, key, name, created_at, updated_at, created_by, updated_by, version)
  VALUES
    ${permRows.join(",\n    ")}
  ON CONFLICT (tenant_id, key) DO NOTHING;
COMMIT;
`);

  const grantPairs = [];
  for (const [roleKey, mods] of Object.entries(DEFAULTS)) {
    for (const [mod, actions] of Object.entries(mods)) {
      for (const action of actions) {
        grantPairs.push(`(${sqlLit(roleKey)}, ${sqlLit(`${mod}.${action}`)})`);
      }
    }
  }
  step(`rbac.role_permissions (${grantPairs.length} grants)`, `
BEGIN;
SELECT set_config('app.tenant_id', ${sqlLit(tenant)}, true);
INSERT INTO rbac.role_permissions (tenant_id, role_id, permission_id, created_at, created_by)
  SELECT ${sqlLit(tenant)}, r.id, p.id, now(), ${sqlLit(ACTOR)}
  FROM rbac.roles r
  JOIN rbac.permissions p ON p.tenant_id = r.tenant_id
  JOIN (VALUES
    ${grantPairs.join(",\n    ")}
  ) AS g(role_key, perm_key) ON g.role_key = r.key AND g.perm_key = p.key
  WHERE r.tenant_id = ${sqlLit(tenant)}
  ON CONFLICT (tenant_id, role_id, permission_id) DO NOTHING;
COMMIT;
`);
}

if (errors > 0) {
  console.error(`\n${errors} step(s) failed.`);
  process.exit(1);
}
console.log("\nDone.");
