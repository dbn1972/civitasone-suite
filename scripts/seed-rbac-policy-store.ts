#!/usr/bin/env tsx
/**
 * RBAC policy-store seed — role -> permission grants.
 *
 * Bug: civitas_policy's roles.roles / roles.permissions / bindings.bindings
 * are empty for every tenant. With no matching `roles` row, findGrantedPermissions()
 * (services/policy-service/src/modules/evaluate/repo.ts) always returns [], so
 * evaluateDecision() (evaluate/domain.ts) denies every non-super_admin actor for
 * every permission-gated action, regardless of the route's own role-gate.
 *
 * This script grants each real permission key discovered under
 * services/**\/routes.ts (via requirePermissionKey(ctx, "...")) to the role(s)
 * that role-gate's own existing requireRole(...) arrays already say should hold
 * it — i.e. it backs the ALREADY-EXPRESSED intent with real grant rows, it does
 * not invent new intent. See the PR description for the file:line evidence
 * behind each mapping below, including the two inferences that go beyond a
 * literal reading of the two example endpoints in the fix brief:
 *   - "manager" gets hrms.leave.approve: hrms leave routes.ts explicitly sends
 *     managers to the workflow queue ("Use the workflow queue") when they lack
 *     HR roles; that queue's task-completion path is gated by this exact
 *     permission key, so without this grant the promised alternative is a
 *     dead end.
 *   - procurement.po.approve is restricted to procurement_admin (not
 *     procurement_officer): po/routes.ts has no direct approve endpoint to
 *     read intent from (PO approval is mediated by the eOffice file-decision
 *     workflow), so this follows the APPROVE_ROLES convention used
 *     consistently elsewhere in procurement-service (amendment-routes.ts,
 *     planning/routes.ts, vendor/scorecard-routes.ts) where "approve" actions
 *     are admin-only, unlike "create/write" actions which include officer.
 *
 * super_admin is deliberately NOT seeded: isSuperAdmin() in
 * packages/auth/src/permissions.ts fast-paths before any policy-service call,
 * so a grant row for it would be inert.
 *
 * Idempotent: checks existing roles/permissions before creating anything, so
 * it's safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/seed-rbac-policy-store.ts
 *
 * Requirements:
 *   - policy-service reachable (default http://127.0.0.1:3003)
 *   - policy-service running with NODE_ENV !== production (enables the HS256
 *     dev-token fallback in packages/auth/src/context.ts) — true of every
 *     other seed script in this repo, see scripts/seed-sprint3.ts.
 */

import { createHmac } from "node:crypto";

const POLICY = process.env.POLICY_SERVICE_URL ?? "http://127.0.0.1:3003";
const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";
const ACTOR_ID = "00000000-0000-0000-0000-000000000099"; // convention shared with scripts/seed-sprint3.ts

// Tenants confirmed (via direct DB query) to hold real, actively-used business
// data as of this seed run: the tenant named in the fix brief's "Access"
// section, PLUS a second tenant found in active use by the existing
// /tmp/*.sh audit scripts (dev-superadmin, dev-officer). Both had real
// leave-application and payroll-run rows — see the PR description.
const TENANTS = [
  "11111111-1111-1111-1111-111111111111",
  "1ebadb1c-f10d-40d8-9bd8-1a14a436705b",
];

const GRANTS: Record<string, Array<{ resource: string; action: string }>> = {
  hr_admin:            [{ resource: "hrms.leave", action: "approve" }],
  hr_officer:          [{ resource: "hrms.leave", action: "approve" }],
  manager:             [{ resource: "hrms.leave", action: "approve" }],
  payroll_admin:       [{ resource: "payroll.run", action: "approve" }],
  payroll_officer:     [{ resource: "payroll.run", action: "approve" }],
  procurement_officer: [{ resource: "procurement.indent", action: "approve" }],
  procurement_admin:   [
    { resource: "procurement.indent", action: "approve" },
    { resource: "procurement.po", action: "approve" },
  ],
};

// ── Minimal HS256 JWT (no external deps) — same technique as
// scripts/seed-sprint3.ts and tests/e2e-personas/helpers/auth.ts. iss/aud
// are required: packages/auth/src/index.ts's verifyToken() validates both
// against HS256_TOKEN_ISSUER/AUDIENCE (default "civitasone-dev"/"civitasone").
// tid/tenantId are deliberately omitted from the payload so toRequestContext()
// falls through to the x-tenant-id header (honoured whenever NODE_ENV !==
// production) — that lets one token seed every tenant in TENANTS via the
// header alone. ──────────────────────────────────────────────────────────
function b64url(data: string): string {
  return Buffer.from(data).toString("base64url");
}
function mintSuperAdminJwt(): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({
    sub: ACTOR_ID,
    iss: "civitasone-dev",
    aud: "civitasone",
    roles: ["super_admin"],
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  }));
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}
const TOKEN = mintSuperAdminJwt();

const ts = () => new Date().toLocaleTimeString();
const log = (...a: unknown[]) => console.log(`[${ts()}]`, ...a);

async function api<T>(tenantId: string, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${POLICY}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${TOKEN}`,
      "x-tenant-id": tenantId,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} (tenant ${tenantId}) -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  if (!text) return undefined as unknown as T;
  try { return JSON.parse(text) as T; } catch { return text as unknown as T; }
}

type RoleRow = { id: string; name: string };
type PermRow = { resource: string; action: string; effect: string };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// POST /policy/roles and POST /policy/roles/:id/permissions are command-queue
// writes (see roles/commands.ts: queue.publish(...), returns {id, status:
// "accepted"} immediately, applied later by policy-worker's outbox relay) —
// observed relay latency on this box ranges from ~1s up to ~40s. Rather than
// block serially on each individual item (slow, and a slow poll timeout on
// item N shouldn't abort items N+1..), this fires all the POSTs for a batch
// up front, then does ONE shared poll-and-retry sweep at the end to confirm
// (and, if truly still missing, re-request) anything that hasn't landed yet.
async function waitUntilAllTrue(checks: Array<() => Promise<boolean>>, roundMs = 2000, maxRounds = 30): Promise<boolean[]> {
  let pending = checks.map((_, i) => i);
  const done = new Array(checks.length).fill(false);
  for (let round = 0; round < maxRounds && pending.length > 0; round++) {
    if (round > 0) await sleep(roundMs);
    const next: number[] = [];
    for (const i of pending) {
      if (await checks[i]!()) done[i] = true; else next.push(i);
    }
    pending = next;
  }
  return done;
}

async function ensureRole(tenantId: string, name: string, existingRoles: RoleRow[]): Promise<{ id: string; created: boolean }> {
  const found = existingRoles.find((r) => r.name === name);
  if (found) return { id: found.id, created: false };
  const accepted = await api<{ id: string }>(
    tenantId, "POST", "/policy/roles",
    { name, description: "seeded by scripts/seed-rbac-policy-store.ts (RBAC policy-store bootstrap)" },
  );
  return { id: accepted.id, created: true };
}

async function roleVisible(tenantId: string, roleId: string): Promise<boolean> {
  const res = await fetch(`${POLICY}/policy/roles/${roleId}`, {
    headers: { authorization: `Bearer ${TOKEN}`, "x-tenant-id": tenantId },
  });
  return res.ok;
}

async function permissionVisible(tenantId: string, roleId: string, resource: string, action: string): Promise<boolean> {
  const after = await api<{ data: PermRow[] }>(tenantId, "GET", `/policy/roles/${roleId}/permissions`);
  return after.data.some((p) => p.resource === resource && p.action === action && p.effect === "allow");
}

async function main() {
  log(`policy-service: ${POLICY}`);
  let totalRolesCreated = 0;
  let totalPermsCreated = 0;
  const failures: string[] = [];

  for (const tenantId of TENANTS) {
    log(`=== tenant ${tenantId} ===`);

    // --- Phase 1: ensure every role exists, then wait for the whole batch. ---
    const existingRolesResp = await api<{ data: RoleRow[] } | RoleRow[]>(tenantId, "GET", "/policy/roles");
    const existingRoles = Array.isArray(existingRolesResp) ? existingRolesResp : existingRolesResp.data;
    const roleIds: Record<string, string> = {};
    const pendingRoleIds: string[] = [];
    for (const roleName of Object.keys(GRANTS)) {
      const { id, created } = await ensureRole(tenantId, roleName, existingRoles);
      roleIds[roleName] = id;
      if (created) { totalRolesCreated++; pendingRoleIds.push(id); }
      log(`  role ${roleName} -> ${id}${created ? " (queued)" : " (existing)"}`);
    }
    if (pendingRoleIds.length) {
      const results = await waitUntilAllTrue(pendingRoleIds.map((id) => () => roleVisible(tenantId, id)));
      results.forEach((ok, i) => { if (!ok) failures.push(`tenant ${tenantId}: role ${pendingRoleIds[i]} never became visible`); });
      log(`  ...${results.filter(Boolean).length}/${pendingRoleIds.length} newly-created roles confirmed visible`);
    }

    // --- Phase 2: ensure every (role, resource, action) grant exists, then wait. ---
    const pendingGrants: Array<{ roleId: string; resource: string; action: string; label: string }> = [];
    for (const [roleName, grants] of Object.entries(GRANTS)) {
      const roleId = roleIds[roleName]!;
      for (const { resource, action } of grants) {
        const already = await permissionVisible(tenantId, roleId, resource, action);
        if (already) { log(`    = ${roleName}: ${resource}.${action}`); continue; }
        await api(tenantId, "POST", `/policy/roles/${roleId}/permissions`, { resource, action, effect: "allow" });
        totalPermsCreated++;
        pendingGrants.push({ roleId, resource, action, label: `${roleName}: ${resource}.${action}` });
        log(`    + ${roleName}: ${resource}.${action} (queued)`);
      }
    }
    if (pendingGrants.length) {
      const results = await waitUntilAllTrue(
        pendingGrants.map((g) => () => permissionVisible(tenantId, g.roleId, g.resource, g.action)),
      );
      results.forEach((ok, i) => { if (!ok) failures.push(`tenant ${tenantId}: grant ${pendingGrants[i]!.label} never became visible`); });
      log(`  ...${results.filter(Boolean).length}/${pendingGrants.length} newly-created grants confirmed visible`);
    }
  }

  log(`Done. ${totalRolesCreated} role(s) created, ${totalPermsCreated} permission(s) created (across ${TENANTS.length} tenants).`);
  if (failures.length) {
    console.error(`\n${failures.length} item(s) never became visible within the poll window:`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("SEED FAILED:", err);
  process.exit(1);
});
