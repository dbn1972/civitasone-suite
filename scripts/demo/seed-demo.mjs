#!/usr/bin/env node
/**
 * seed-demo.mjs — DEV-ONLY demo seed for CivitasOne.
 * =====================================================================
 * ⚠  DEV / DEMO ONLY. Never run against production. Creates persona users
 *    with a well-known demo password (Demo@12345) so a human can log in and
 *    click through the suite. These credentials MUST NEVER exist in prod.
 * =====================================================================
 *
 * Idempotent + re-runnable. Provisions:
 *   1. A stable demo tenant (reuses 00000000-…-0001 if present) + a 2nd tenant
 *      (…-0002) used for the cross-department / consent-exchange demo.
 *   2. ~12 persona users spanning the main government roles, in THREE places:
 *        a. identity-service  users.users            (app identity)
 *        b. identity-service  rbac.roles / rbac.role_assignments (app RBAC + tenant membership)
 *        c. Keycloak realm `civitasone`              (OIDC realm users + realm roles), best-effort
 *   3. Representative module data across high-visibility modules by invoking the
 *      existing, battle-tested scripts/dev/seed-all.mjs (idempotent).
 *   4. Per-persona HS256 access tokens (written to scripts/demo/.tokens/, gitignored)
 *      for headless API testing and for the "set-cookie" web-login method.
 *
 * The running fleet authenticates with HS256 (JWT_ALGORITHM=HS256,
 * JWT_SECRET=civitasone-dev-secret) — see DEMO-ACCESS.md. Keycloak is
 * provisioned for completeness / OIDC-mode readiness but is not the active path.
 *
 * Usage:
 *   node scripts/demo/seed-demo.mjs
 *
 * Env overrides:
 *   PG_CONTAINER   (default civitasone-postgres)   docker container for psql
 *   JWT_SECRET     (default civitasone-dev-secret)  HS256 signing secret (must match the fleet)
 *   GATEWAY        (default http://localhost:8080)  gateway base URL for verification
 *   DEMO_PASSWORD  (default Demo@12345)             DEV-ONLY demo password
 *   KEYCLOAK_URL / KC_ADMIN_USER / KC_ADMIN_PASSWORD  Keycloak admin (best-effort)
 *   SKIP_MODULE_DATA=1   skip the seed-all.mjs module-data step
 *   SKIP_KEYCLOAK=1      skip Keycloak provisioning
 */
import { execSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// ── config ───────────────────────────────────────────────────────────────────
const PG_CONTAINER = process.env.PG_CONTAINER || "civitasone-postgres";
const SECRET = process.env.JWT_SECRET || "civitasone-dev-secret";
const GATEWAY = process.env.GATEWAY || "http://localhost:8080";
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || "Demo@12345"; // DEV-ONLY
const KC_URL = process.env.KEYCLOAK_URL || "http://localhost:8180";
const KC_REALM = "civitasone";
const KC_ADMIN_USER = process.env.KC_ADMIN_USER || "admin";
const KC_ADMIN_PASSWORD = process.env.KC_ADMIN_PASSWORD || "civitas_kc_dev_pw";

const T1 = "00000000-0000-0000-0000-000000000001"; // Demo Municipal Corporation
const T2 = "00000000-0000-0000-0000-000000000002"; // Partner dept (consent-exchange demo)
const ACTOR = "00000000-0000-0000-0000-000000000099"; // seed actor (== superadmin persona)

// ── personas ─────────────────────────────────────────────────────────────────
// roles[0] is the "primary" role; all roles are embedded in the token and mapped
// as app RBAC roles. `what` = what this persona can meaningfully test.
const PERSONAS = [
  { username: "superadmin",         sub: ACTOR,                                    tenant: T1, name: "Super Admin (Platform)",         email: "superadmin@demo.gov.in",
    roles: ["super_admin", "platform_admin", "admin", "tenant_admin"],
    what: "Everything — platform admin, all modules, all tenants" },
  { username: "commissioner",       sub: "0de00000-0000-0000-0000-000000000001",   tenant: T1, name: "Municipal Commissioner",        email: "commissioner@demo.gov.in",
    roles: ["tenant_admin", "admin"],
    what: "Tenant admin — org setup, users, module config, dashboards" },
  { username: "hrofficer",          sub: "0de00000-0000-0000-0000-000000000002",   tenant: T1, name: "HR / Establishment Officer",    email: "hrofficer@demo.gov.in",
    roles: ["hr_officer", "hr_admin", "estab_officer"],
    what: "HRMS — employees, departments, leave, attendance; Establishment files" },
  { username: "financeofficer",     sub: "0de00000-0000-0000-0000-000000000003",   tenant: T1, name: "Finance / Budget Officer",      email: "financeofficer@demo.gov.in",
    roles: ["finance_officer", "budget_officer"],
    what: "Finance — budget heads, allocations, sanctions, bills (read/prepare)" },
  { username: "financeadmin",       sub: "0de00000-0000-0000-0000-000000000004",   tenant: T1, name: "Chief Accounts Officer",        email: "financeadmin@demo.gov.in",
    roles: ["finance_admin"],
    what: "Finance — approve sanctions/bills/payments (approver tier)" },
  { username: "procurementofficer", sub: "0de00000-0000-0000-0000-000000000005",   tenant: T1, name: "Procurement Officer",           email: "procurementofficer@demo.gov.in",
    roles: ["procurement_officer", "procurement_admin"],
    what: "Procurement — vendors, indents, RFQs, tenders, POs, GRNs" },
  { username: "auditor",            sub: "0de00000-0000-0000-0000-000000000006",   tenant: T1, name: "Internal Auditor",              email: "auditor@demo.gov.in",
    roles: ["audit_officer", "audit_admin"],
    what: "Audit — audit plans, observations, risk register; read-only finance" },
  { username: "legalofficer",       sub: "0de00000-0000-0000-0000-000000000007",   tenant: T1, name: "Law Officer",                   email: "legalofficer@demo.gov.in",
    roles: ["legal_officer", "legal_admin"],
    what: "Legal — cases, hearings, notices, legal opinions/orders" },
  { username: "inspector",          sub: "0de00000-0000-0000-0000-000000000008",   tenant: T1, name: "Field Inspector",               email: "inspector@demo.gov.in",
    roles: ["inspector", "inspection_admin"],
    what: "Inspection — inspection templates, field instances, findings" },
  { username: "grievanceofficer",   sub: "0de00000-0000-0000-0000-000000000009",   tenant: T1, name: "Grievance / Dept Officer",     email: "grievanceofficer@demo.gov.in",
    roles: ["grievance_officer", "citizen_officer", "dept_officer"],
    what: "Citizen desk — service applications, grievances, RTI (officer side)" },
  { username: "citizen",            sub: "0de00000-0000-0000-0000-00000000000a",   tenant: T1, name: "Citizen (Public User)",         email: "citizen@demo.gov.in",
    roles: ["citizen"],
    what: "Citizen portal — file a grievance / service application / RTI" },
  { username: "dataprincipal",      sub: "0de00000-0000-0000-0000-00000000000b",   tenant: T1, name: "Data Principal (Consent)",      email: "dataprincipal@demo.gov.in",
    roles: ["data_principal", "citizen"],
    what: "Data governance — grant/revoke consent for cross-dept data sharing" },
  { username: "partnerofficer",     sub: "0de00000-0000-0000-0000-00000000000c",   tenant: T2, name: "Partner Dept Officer",          email: "partnerofficer@demo.gov.in",
    roles: ["tenant_admin", "dept_officer", "citizen_officer"],
    what: "SECOND tenant — proves tenant isolation & the consent-exchange counterparty" },
];

// distinct role keys across all personas (for RBAC role + Keycloak realm-role creation)
const ALL_ROLE_KEYS = [...new Set(PERSONAS.flatMap((p) => p.roles))].sort();

// ── helpers ──────────────────────────────────────────────────────────────────
let errors = 0;
function psql(db, sql) {
  execSync(`docker exec -i ${PG_CONTAINER} psql -U civitas_admin -d ${db} -v ON_ERROR_STOP=1`, {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function step(db, label, sql) {
  try {
    psql(db, sql);
    console.log(`  ✓ ${label}`);
  } catch (err) {
    const msg = ((err.stderr ?? "") + (err.stdout ?? "")).toString().trim();
    console.error(`  ✗ ${label}: ${msg.slice(0, 500)}`);
    errors++;
  }
}
function q(db, sql) {
  return execSync(`docker exec -i ${PG_CONTAINER} psql -U civitas_admin -d ${db} -tA`, {
    input: sql,
    stdio: ["pipe", "pipe", "pipe"],
  }).toString().trim();
}
function b64url(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function mintToken(p) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url({ alg: "HS256", typ: "JWT" });
  const payload = b64url({
    sub: p.sub, iss: "civitasone-dev", aud: "civitasone",
    tid: p.tenant, tenantId: p.tenant, sid: "demo-session",
    email: p.email, name: p.name, roles: p.roles,
    iat: now, exp: now + 60 * 60 * 12, // 12h
  });
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

// ── 1. tenants ────────────────────────────────────────────────────────────────
console.log("\n=== 1. demo tenants ===");
step("civitas_tenant", "tenants", `
INSERT INTO tenant.tenants (id, tenant_id, name, domain, edition, status, region, residency, settings, created_at, updated_at, created_by, updated_by, version)
VALUES
  ('${T1}', '${T1}', 'Demo Municipal Corporation (DEV DEMO)', 'demo-city.civitasone.in',    'govt', 'active', 'ap-south-1', 'in', '{}', now(), now(), '${ACTOR}', '${ACTOR}', 1),
  ('${T2}', '${T2}', 'Partner Revenue Department (DEV DEMO)', 'partner-rev.civitasone.in', 'govt', 'active', 'ap-south-1', 'in', '{}', now(), now(), '${ACTOR}', '${ACTOR}', 1)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, edition = 'govt', updated_at = now();
`);

// ── 2a. identity users ────────────────────────────────────────────────────────
console.log("\n=== 2a. identity-service users ===");
const userValues = PERSONAS.map((p) =>
  `('${p.sub}', '${p.tenant}', '${p.email}', '${p.name.replace(/'/g, "''")}', 'active', false, now(), now(), '${ACTOR}', '${ACTOR}', 1)`
).join(",\n  ");
step("civitas_identity", `${PERSONAS.length} persona users`, `
INSERT INTO users.users (id, tenant_id, email, name, status, mfa_enabled, created_at, updated_at, created_by, updated_by, version)
VALUES
  ${userValues}
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, tenant_id = EXCLUDED.tenant_id, status = 'active', updated_at = now();
`);

// ── 2b. identity RBAC roles + assignments (tenant-scoped, RLS GUC set) ─────────
console.log("\n=== 2b. identity-service RBAC roles + assignments (tenant membership) ===");
// deterministic role id per (tenant, key) so re-runs are idempotent
function roleId(tenant, key) {
  const h = createHmac("sha256", "role").update(`${tenant}:${key}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
function assignId(tenant, key, sub) {
  const h = createHmac("sha256", "assign").update(`${tenant}:${key}:${sub}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
for (const tenant of [T1, T2]) {
  const keys = [...new Set(PERSONAS.filter((p) => p.tenant === tenant).flatMap((p) => p.roles))];
  const roleRows = keys.map((k) =>
    `('${roleId(tenant, k)}', '${tenant}', '${k}', '${k.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}', 'demo role', false, now(), now(), '${ACTOR}', '${ACTOR}', 1)`
  ).join(",\n    ");
  const assignRows = PERSONAS.filter((p) => p.tenant === tenant).flatMap((p) =>
    p.roles.map((k) => `('${assignId(tenant, k, p.sub)}', '${tenant}', '${roleId(tenant, k)}', '${p.sub}', 'active', now(), now(), '${ACTOR}', '${ACTOR}', 1)`)
  ).join(",\n    ");
  // set the RLS GUC so inserts satisfy the forced tenant_isolation_policy WITH CHECK
  step("civitas_identity", `rbac roles+assignments for tenant ${tenant.slice(-4)}`, `
BEGIN;
SELECT set_config('app.tenant_id', '${tenant}', true);
INSERT INTO rbac.roles (id, tenant_id, key, name, description, is_system, created_at, updated_at, created_by, updated_by, version)
  VALUES
    ${roleRows}
  ON CONFLICT (tenant_id, key) DO UPDATE SET name = EXCLUDED.name, updated_at = now();
INSERT INTO rbac.role_assignments (id, tenant_id, role_id, user_id, status, created_at, updated_at, created_by, updated_by, version)
  VALUES
    ${assignRows}
  ON CONFLICT (tenant_id, role_id, user_id) DO UPDATE SET status = 'active', updated_at = now();
COMMIT;
`);
}

// ── 3. module data (existing idempotent seed) ─────────────────────────────────
if (process.env.SKIP_MODULE_DATA === "1") {
  console.log("\n=== 3. module data — SKIPPED (SKIP_MODULE_DATA=1) ===");
} else {
  console.log("\n=== 3. module data via scripts/dev/seed-all.mjs ===");
  try {
    execSync(`node ${join(ROOT, "scripts/dev/seed-all.mjs")}`, { stdio: "inherit" });
    console.log("  ✓ module data seeded");
  } catch {
    console.error("  ✗ seed-all.mjs reported errors (see output above) — continuing");
    errors++;
  }
}

// ── 4. Keycloak realm users (best-effort; not the active auth path) ───────────
async function seedKeycloak() {
  if (process.env.SKIP_KEYCLOAK === "1") { console.log("\n=== 4. Keycloak — SKIPPED ==="); return; }
  console.log("\n=== 4. Keycloak realm provisioning (best-effort) ===");
  try {
    const tokRes = await fetch(`${KC_URL}/realms/master/protocol/openid-connect/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: "admin-cli", username: KC_ADMIN_USER, password: KC_ADMIN_PASSWORD, grant_type: "password" }),
    });
    if (!tokRes.ok) { console.log(`  ⚠ Keycloak admin login failed (HTTP ${tokRes.status}) — skipping (HS256 is the active path)`); return; }
    const kct = (await tokRes.json()).access_token;
    const H = { authorization: `Bearer ${kct}`, "content-type": "application/json" };
    const api = `${KC_URL}/admin/realms/${KC_REALM}`;

    // realm roles
    for (const key of ALL_ROLE_KEYS) {
      const r = await fetch(`${api}/roles`, { method: "POST", headers: H, body: JSON.stringify({ name: key }) });
      if (r.status !== 201 && r.status !== 409) console.log(`  ⚠ role ${key}: HTTP ${r.status}`);
    }
    console.log(`  ✓ ${ALL_ROLE_KEYS.length} realm roles ensured`);

    let created = 0, updated = 0;
    for (const p of PERSONAS) {
      // find by username
      const findRes = await fetch(`${api}/users?username=${encodeURIComponent(p.username)}&exact=true`, { headers: H });
      const found = findRes.ok ? await findRes.json() : [];
      let uid = found[0]?.id;
      // Keycloak 24's declarative user profile rejects firstName/lastName with
      // characters like '/' or '()' — strip them to plain letters/spaces.
      const clean = p.name.replace(/[^A-Za-z ]+/g, " ").replace(/\s+/g, " ").trim() || "Demo User";
      const body = {
        username: p.username, email: p.email, emailVerified: true, enabled: true,
        firstName: clean.split(" ")[0], lastName: clean.split(" ").slice(1).join(" ") || "User",
        attributes: { tid: [p.tenant], identity_user_id: [p.sub] },
      };
      if (!uid) {
        const c = await fetch(`${api}/users`, { method: "POST", headers: H, body: JSON.stringify(body) });
        if (c.status === 201) { created++; const loc = c.headers.get("location"); uid = loc ? loc.split("/").pop() : undefined; }
        else if (c.status !== 409) { console.log(`  ⚠ user ${p.username}: HTTP ${c.status}`); continue; }
        if (!uid) { const rf = await fetch(`${api}/users?username=${encodeURIComponent(p.username)}&exact=true`, { headers: H }); uid = (await rf.json())[0]?.id; }
      } else {
        await fetch(`${api}/users/${uid}`, { method: "PUT", headers: H, body: JSON.stringify(body) });
        updated++;
      }
      if (!uid) continue;
      // set DEV-ONLY password (non-temporary)
      await fetch(`${api}/users/${uid}/reset-password`, { method: "PUT", headers: H, body: JSON.stringify({ type: "password", value: DEMO_PASSWORD, temporary: false }) });
      // map realm roles
      const roleReps = [];
      for (const key of p.roles) {
        const rr = await fetch(`${api}/roles/${encodeURIComponent(key)}`, { headers: H });
        if (rr.ok) roleReps.push(await rr.json());
      }
      if (roleReps.length) await fetch(`${api}/users/${uid}/role-mappings/realm`, { method: "POST", headers: H, body: JSON.stringify(roleReps) });
    }
    console.log(`  ✓ Keycloak personas: ${created} created, ${updated} updated, password set to the demo password`);
  } catch (e) {
    console.log(`  ⚠ Keycloak provisioning skipped: ${String(e).slice(0, 160)}`);
  }
}

// ── 5. tokens + verification ──────────────────────────────────────────────────
async function verify() {
  console.log("\n=== 5. mint tokens + verify ===");
  const tokenDir = join(HERE, ".tokens");
  mkdirSync(tokenDir, { recursive: true });
  const tokens = {};
  for (const p of PERSONAS) {
    const t = mintToken(p);
    tokens[p.username] = t;
    writeFileSync(join(tokenDir, `${p.username}.jwt`), t);
  }
  writeFileSync(join(tokenDir, "all.json"), JSON.stringify(
    Object.fromEntries(PERSONAS.map((p) => [p.username, { token: tokens[p.username], tenant: p.tenant, roles: p.roles }])), null, 2));
  console.log(`  ✓ ${PERSONAS.length} tokens written to scripts/demo/.tokens/ (gitignored)`);

  // 5a. auth path: token accepted by the gateway (200/expected, NOT 401)
  console.log("\n  -- auth check (gateway accepts persona tokens) --");
  for (const uname of ["superadmin", "financeofficer", "procurementofficer", "partnerofficer"]) {
    try {
      const res = await fetch(`${GATEWAY}/api/v1/finance/budgets`, { headers: { authorization: `Bearer ${tokens[uname]}` } });
      console.log(`     ${uname.padEnd(18)} HTTP ${res.status} ${res.status === 401 ? "AUTH-FAIL" : "auth-ok"}`);
    } catch (e) { console.log(`     ${uname}: ${String(e).slice(0, 80)}`); }
  }

  // 5b. RLS tenant isolation at the DB layer (proves data is tenant-scoped and
  //     NOT cross-tenant), exercised as the NOBYPASSRLS finance_svc role — NOT
  //     as the superuser civitas_admin, which BYPASSes RLS.
  console.log("\n  -- RLS tenant-isolation check (finance_svc role, GUC-scoped) --");
  const lastInt = (out) => out.split("\n").map((x) => x.trim()).filter((x) => /^\d+$/.test(x)).pop() ?? "?";
  const isoSql = (tenant) => `SET ROLE finance_svc;\nSELECT set_config('app.tenant_id','${tenant}', false);\nSELECT count(*) FROM budget.finance_budgets;\nRESET ROLE;`;
  try {
    const t1rows = lastInt(q("civitas_finance", isoSql(T1)));
    const t2rows = lastInt(q("civitas_finance", isoSql(T2)));
    console.log(`     tenant T1 (…0001) sees ${t1rows} budget rows`);
    console.log(`     tenant T2 (…0002) sees ${t2rows} budget rows  ${t2rows === "0" ? "(isolated ✓)" : ""}`);
    console.log(`     ⇒ ${Number(t1rows) > 0 && t2rows === "0" ? "TENANT ISOLATION CONFIRMED ✓" : "check counts above"}`);
  } catch (e) { console.log(`     isolation check error: ${String(e).slice(0, 120)}`); }

  // 5c. identity RBAC assignment count per tenant, as the NOBYPASSRLS identity_svc
  //     role so RLS actually filters (proves app-side membership + isolation).
  console.log("\n  -- app RBAC membership (identity_svc role, GUC-scoped) --");
  const rbacSql = (tenant) => `SET ROLE identity_svc;\nSELECT set_config('app.tenant_id','${tenant}', false);\nSELECT count(*) FROM rbac.role_assignments;\nRESET ROLE;`;
  try {
    const a1 = lastInt(q("civitas_identity", rbacSql(T1)));
    const a2 = lastInt(q("civitas_identity", rbacSql(T2)));
    console.log(`     tenant T1 (…0001): ${a1} role assignments · tenant T2 (…0002): ${a2} role assignments (isolated)`);
  } catch (e) { console.log(`     rbac check error: ${String(e).slice(0, 120)}`); }
}

await seedKeycloak();
await verify();

console.log("\n────────────────────────────────────────────");
console.log(`Demo seed complete. Errors: ${errors}`);
console.log(`Tenants: T1=${T1} (Demo Municipal Corporation), T2=${T2} (Partner Revenue Dept)`);
console.log(`Personas: ${PERSONAS.length}  ·  demo password: ${DEMO_PASSWORD}  (DEV-ONLY)`);
console.log("Login card: scripts/demo/DEMO-ACCESS.md");
console.log("────────────────────────────────────────────");
if (errors > 0) process.exitCode = 1;
