#!/usr/bin/env node
/**
 * Live security UAT against gateway :8080
 * Usage: node scripts/uat/security-live-uat.mjs
 */
import { createHmac, randomUUID } from "node:crypto";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const SECRET = process.env.JWT_SECRET ?? "civitasone-dev-secret";

const T1 = "00000000-0000-0000-0000-000000000001";
const T2 = "00000000-0000-0000-0000-000000000002";
const ACTOR = "00000000-0000-0000-0000-000000000099";

// Seed resource IDs
const SEED = {
  billT1: "dddddddd-0001-0000-0000-000000000007",
  invoiceT2: "cccccccc-0002-0000-0000-000000000006",
  breakglassT1: "bbbbbbbb-0004-0000-0000-000000000001",
  auditEventT1: "99999999-0001-0000-0000-000000000001",
  workflowTaskT1: "11111111-0003-0000-0000-000000000004",
};

const findings = [];
let findingSeq = 0;

function mintJWT({ sub = ACTOR, tid = T1, roles = ["super_admin"], expOffsetSec = 3600, omitTid = false } = {}) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payloadObj = {
    sub,
    iss: "civitasone-dev",
    aud: "civitasone",
    roles,
    exp: Math.floor(Date.now() / 1000) + expOffsetSec,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  };
  if (!omitTid) {
    payloadObj.tid = tid;
    payloadObj.tenantId = tid;
  }
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

async function req(path, opts = {}) {
  const url = `${GATEWAY}${path}`;
  const headers = { "x-correlation-id": randomUUID(), ...(opts.headers ?? {}) };
  const init = { method: opts.method ?? "GET", headers };
  if (opts.body) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.body);
  }
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    return { status: 0, body: String(err), headers: {} };
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* raw */ }
  return { status: res.status, body: text, json, headers: Object.fromEntries(res.headers.entries()) };
}

function record(id, severity, title, expected, actual, pass, evidence) {
  findings.push({ id, severity, title, expected, actual, pass, evidence });
}

function assertBlocked(id, severity, title, res, evidence) {
  const blocked = [401, 403, 404].includes(res.status);
  record(id, severity, title, "401/403/404", String(res.status), blocked, evidence);
  return blocked;
}

const SENSITIVE = [
  "/api/v1/finance/bills",
  "/api/v1/finance/payments",
  "/api/v1/payroll/runs",
  "/api/v1/hrms/employees",
  "/api/v1/admin/breakglass",
  "/api/v1/audit/events",
  "/api/v1/workflow/tasks",
];

console.log(`\n=== CivitasOne Security UAT — ${GATEWAY} ===\n`);

// ── 1. Auth bypass ──────────────────────────────────────────────────────────
console.log("1. Auth bypass...");
for (const path of SENSITIVE) {
  const noToken = await req(path);
  assertBlocked(
    `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
    "P0",
    `No token blocked: ${path}`,
    noToken,
    { path, body: noToken.body.slice(0, 200) },
  );

  const malformed = await req(path, {
    headers: { authorization: "Bearer not.a.valid.jwt.token" },
  });
  assertBlocked(
    `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
    "P0",
    `Malformed token blocked: ${path}`,
    malformed,
    { path, body: malformed.body.slice(0, 200) },
  );

  const expired = await req(path, {
    headers: { authorization: `Bearer ${mintJWT({ expOffsetSec: -3600 })}` },
  });
  assertBlocked(
    `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
    "P0",
    `Expired token blocked: ${path}`,
    expired,
    { path, body: expired.body.slice(0, 200) },
  );
}

// ── 2. Tenant isolation ─────────────────────────────────────────────────────
console.log("2. Tenant isolation...");
const tokenT1 = mintJWT({ tid: T1, roles: ["super_admin"] });

const tokenT2Finance = mintJWT({ tid: T2, roles: ["finance_admin"] });
const crossTenantBill = await req(`/api/v1/finance/bills/${SEED.billT1}`, {
  headers: { authorization: `Bearer ${tokenT2Finance}`, "x-tenant-id": T2 },
});
assertBlocked(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "Tenant B JWT cannot read Tenant A finance bill by ID",
  crossTenantBill,
  { billId: SEED.billT1, status: crossTenantBill.status, body: crossTenantBill.body.slice(0, 300) },
);

const crossTenantInfo = await req(`/api/v1/tenants/${T2}`, {
  headers: { authorization: `Bearer ${tokenT1}`, "x-tenant-id": T1 },
});
const tenantBlocked = [403, 404].includes(crossTenantInfo.status);
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "Tenant A JWT cannot read Tenant B tenant record",
  "403 or 404",
  String(crossTenantInfo.status),
  tenantBlocked,
  { body: crossTenantInfo.body.slice(0, 300) },
);

const crossInvoice = await req(`/api/v1/billing/tenants/${T2}/invoices`, {
  headers: { authorization: `Bearer ${tokenT1}`, "x-tenant-id": T1 },
});
const invoiceBlocked = [403, 404].includes(crossInvoice.status) ||
  (crossInvoice.status === 200 && !crossInvoice.body.includes(SEED.invoiceT2));
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "Tenant A JWT cannot list Tenant B billing invoices",
  "403/404 or empty",
  String(crossInvoice.status),
  invoiceBlocked,
  { body: crossInvoice.body.slice(0, 300) },
);

// ── 3. Role escalation ──────────────────────────────────────────────────────
console.log("3. Role escalation...");
const citizenToken = mintJWT({ tid: T1, roles: ["citizen"] });

const citizenFinance = await req("/api/v1/finance/payments", {
  headers: { authorization: `Bearer ${citizenToken}` },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "Citizen role blocked from finance/payments",
  "403",
  String(citizenFinance.status),
  citizenFinance.status === 403,
  { body: citizenFinance.body.slice(0, 200) },
);

const citizenBreakglass = await req("/api/v1/admin/breakglass", {
  headers: { authorization: `Bearer ${citizenToken}` },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "Citizen role blocked from admin/breakglass",
  "403",
  String(citizenBreakglass.status),
  citizenBreakglass.status === 403,
  { body: citizenBreakglass.body.slice(0, 200) },
);

const citizenPayroll = await req("/api/v1/payroll/runs", {
  headers: { authorization: `Bearer ${citizenToken}` },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "Citizen role blocked from payroll/runs",
  "403",
  String(citizenPayroll.status),
  citizenPayroll.status === 403,
  { body: citizenPayroll.body.slice(0, 200) },
);

// ── 4. Forged headers ───────────────────────────────────────────────────────
console.log("4. Forged headers...");
const noJwtTenantHeader = await req("/api/v1/finance/bills", {
  headers: { "x-tenant-id": T1, "x-user-id": ACTOR },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "X-Tenant-Id + X-User-Id without JWT rejected at gateway",
  "401",
  String(noJwtTenantHeader.status),
  noJwtTenantHeader.status === 401,
  { body: noJwtTenantHeader.body.slice(0, 200) },
);

const internalBypass = await req("/api/v1/finance/bills", {
  headers: { "x-internal": "1", "x-tenant-id": T1, "x-service-secret": "stolen" },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P0",
  "x-internal bypass without Bearer rejected",
  "401",
  String(internalBypass.status),
  internalBypass.status === 401,
  { body: internalBypass.body.slice(0, 200) },
);

const headerOnlyTenant = await req("/api/v1/finance/bills", {
  headers: {
    authorization: `Bearer ${mintJWT({ omitTid: true, roles: ["finance_admin"] })}`,
    "x-tenant-id": T1,
  },
});
const headerTenantOk = headerOnlyTenant.status === 200 || headerOnlyTenant.status === 403;
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P2",
  "JWT without tid falls back to X-Tenant-Id (dev behavior)",
  "200 with tenant scope or 403 if role missing",
  String(headerOnlyTenant.status),
  headerTenantOk,
  { body: headerOnlyTenant.body.slice(0, 200), note: "Document if intentional for dev; prod should require tid claim" },
);

const jwtTenantOverride = await req(`/api/v1/finance/bills/${SEED.billT1}`, {
  headers: {
    authorization: `Bearer ${mintJWT({ tid: T1, roles: ["finance_admin"] })}`,
    "x-tenant-id": T2,
  },
});
const overrideBlocked = jwtTenantOverride.status === 404 || jwtTenantOverride.status === 403;
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P1",
  "X-Tenant-Id cannot override JWT tid for cross-tenant access",
  "404/403 (bill scoped to JWT tenant)",
  String(jwtTenantOverride.status),
  overrideBlocked,
  { body: jwtTenantOverride.body.slice(0, 200) },
);

// ── 5. Sensitive data in errors ─────────────────────────────────────────────
console.log("5. Error response leakage...");
const leakPatterns = [/stack/i, /at\s+\S+\.(ts|js):\d+/i, /node_modules/i, /Error:\s/];
function hasLeak(body) {
  return leakPatterns.some((p) => p.test(body));
}

const badRoute = await req("/api/v1/finance/bills/not-a-uuid", {
  headers: { authorization: `Bearer ${mintJWT({ roles: ["finance_admin"] })}` },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P1",
  "Validation error does not leak stack trace",
  "no stack trace in body",
  hasLeak(badRoute.body) ? "LEAK DETECTED" : "clean",
  !hasLeak(badRoute.body),
  { status: badRoute.status, body: badRoute.body.slice(0, 400) },
);

const notFound = await req("/api/v1/finance/bills/00000000-0000-0000-0000-000000000000", {
  headers: { authorization: `Bearer ${mintJWT({ roles: ["finance_admin"] })}` },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P1",
  "404 error does not leak stack trace",
  "no stack trace",
  hasLeak(notFound.body) ? "LEAK DETECTED" : "clean",
  !hasLeak(notFound.body),
  { status: notFound.status, body: notFound.body.slice(0, 400) },
);

const postBad = await req("/api/v1/finance/bills", {
  method: "POST",
  headers: { authorization: `Bearer ${mintJWT({ roles: ["finance_admin"] })}` },
  body: { invalid: true },
});
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P1",
  "POST validation error does not leak stack trace",
  "no stack trace",
  hasLeak(postBad.body) ? "LEAK DETECTED" : "clean",
  !hasLeak(postBad.body),
  { status: postBad.status, body: postBad.body.slice(0, 400) },
);

// ── 6. Audit trail ──────────────────────────────────────────────────────────
console.log("6. Audit trail...");
const adminToken = mintJWT({ tid: T1, roles: ["super_admin"] });

const breakglass = await req("/api/v1/admin/breakglass", {
  headers: { authorization: `Bearer ${adminToken}` },
});
const bgHasSeed = breakglass.status === 200 &&
  (breakglass.body.includes(SEED.breakglassT1) || breakglass.body.includes("Emergency access"));
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P2",
  "Breakglass log accessible to super_admin with seed data",
  "200 with seed entries",
  `${breakglass.status}${bgHasSeed ? " + seed" : ""}`,
  bgHasSeed,
  { body: breakglass.body.slice(0, 500) },
);

const auditEvents = await req("/api/v1/audit/events", {
  headers: { authorization: `Bearer ${adminToken}` },
});
const auditHasSeed = auditEvents.status === 200 &&
  (auditEvents.body.includes(SEED.auditEventT1) || auditEvents.body.includes("budget.sanctioned"));
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P2",
  "Audit events endpoint returns seed workflow/finance events",
  "200 with events",
  `${auditEvents.status}${auditHasSeed ? " + seed" : ""}`,
  auditHasSeed,
  { body: auditEvents.body.slice(0, 500) },
);

const workflowTasks = await req("/api/v1/workflow/tasks", {
  headers: { authorization: `Bearer ${adminToken}` },
});
const wfHasSeed = workflowTasks.status === 200 &&
  workflowTasks.body.includes(SEED.workflowTaskT1);
record(
  `UAT-SEC-${String(++findingSeq).padStart(3, "0")}`,
  "P2",
  "Workflow tasks list includes seed pending task",
  "200 with seed task",
  `${workflowTasks.status}${wfHasSeed ? " + seed" : ""}`,
  wfHasSeed,
  { body: workflowTasks.body.slice(0, 500) },
);

// ── Summary ─────────────────────────────────────────────────────────────────
const failed = findings.filter((f) => !f.pass);
const p0fail = failed.filter((f) => f.severity === "P0");
const p1fail = failed.filter((f) => f.severity === "P1");
const p2fail = failed.filter((f) => f.severity === "P2");

const gate = p0fail.length > 0 ? "FAIL" : p1fail.length > 0 ? "CONDITIONAL FAIL" : "PASS";

console.log("\n=== FINDINGS ===\n");
for (const f of findings) {
  const icon = f.pass ? "PASS" : "FAIL";
  console.log(`[${icon}] ${f.id} (${f.severity}) — ${f.title}`);
  if (!f.pass) console.log(`       expected: ${f.expected}, got: ${f.actual}`);
}

console.log("\n=== GATE VERDICT ===");
console.log(`Total: ${findings.length} | Pass: ${findings.length - failed.length} | Fail: ${failed.length}`);
console.log(`P0 failures: ${p0fail.length} | P1 failures: ${p1fail.length} | P2 failures: ${p2fail.length}`);
console.log(`Production gate: ${gate === "PASS" ? "PASS" : gate === "CONDITIONAL FAIL" ? "FAIL (P1 open)" : "FAIL"}`);

process.exit(p0fail.length > 0 ? 1 : 0);
