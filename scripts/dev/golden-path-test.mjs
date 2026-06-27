#!/usr/bin/env node
/**
 * golden-path-test.mjs — end-to-end golden path verification against live services.
 *
 * Tests every major flow a clerk walks: wizard reads, sample-data, first transactions
 * (finance journal, procurement indent, leave apply, payroll run creation), activation
 * funnel, and the platform funnel. Prints a pass/fail report with timing.
 *
 * Usage:  node scripts/dev/golden-path-test.mjs
 * Env:    GATEWAY (default http://localhost:8080), JWT_SECRET
 */
import { createHmac } from "node:crypto";

const GW = process.env.GATEWAY || "http://localhost:8080";
const SECRET = process.env.JWT_SECRET || "civitasone-dev-secret";
const TENANT = "00000000-0000-0000-0000-000000000001";

function b64url(o) { return Buffer.from(JSON.stringify(o)).toString("base64url"); }
function mint(roles = ["super_admin", "finance_admin", "hr_admin", "procurement_admin"], tid = TENANT) {
  const now = Math.floor(Date.now() / 1000);
  const h = b64url({ alg: "HS256", typ: "JWT" });
  const p = b64url({ sub: "00000000-0000-0000-0000-000000000099", iss: "civitasone-dev", tid, tenantId: tid, sid: "test", roles, iat: now, exp: now + 1800 });
  const s = createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

const TOKEN = mint();
const results = [];

async function test(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
  } catch (e) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: e.message || String(e) });
  }
}

async function get(path, expect = 200) {
  const res = await fetch(`${GW}${path}`, { headers: { authorization: `Bearer ${TOKEN}` } });
  if (res.status !== expect) throw new Error(`GET ${path} -> ${res.status} (expected ${expect})`);
  return res.json();
}

async function post(path, body, expect = [200, 201, 202]) {
  const res = await fetch(`${GW}${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!expect.includes(res.status)) throw new Error(`POST ${path} -> ${res.status} (expected ${expect})`);
  return { status: res.status, body: await res.json().catch(() => null) };
}

// ── WIZARD READS ──
await test("wizard: /tenants/current", () => get("/api/v1/tenants/current"));
await test("wizard: /locations", () => get("/api/v1/locations"));
await test("wizard: /hrms/org-chart", () => get("/api/v1/hrms/org-chart"));
await test("wizard: /identity/users", () => get("/api/identity/users"));
await test("wizard: /admin/tenant/modules", () => get("/api/v1/admin/tenant/modules"));
await test("wizard: /finance/accounts", () => get("/api/v1/finance/accounts"));
await test("wizard: /hrms/admin/leave-policies", () => get("/api/v1/hrms/admin/leave-policies"));
await test("wizard: /payroll/structures", () => get("/api/v1/payroll/structures"));

// ── SAMPLE DATA ──
await test("sample: seed locations", () => post("/api/v1/locations/sample-data", {}));
await test("sample: seed finance bills", () => post("/api/v1/finance/bills/sample-data", {}));
await test("sample: list locations (has samples)", async () => {
  const j = await get("/api/v1/locations");
  const rows = j.data || j;
  if (!rows.some(r => r.isSample || String(r.name).includes("[SAMPLE]"))) throw new Error("no sample rows found");
});
await test("sample: list bills (has samples)", async () => {
  const j = await get("/api/v1/finance/bills");
  const rows = Array.isArray(j) ? j : (j.data || j.items || []);
  if (!rows.some(r => String(r.billNo).includes("[SAMPLE]"))) throw new Error("no sample bills found");
});

// ── FIRST TRANSACTIONS ──
await test("tx: finance journal post", async () => {
  const accounts = await get("/api/v1/finance/accounts");
  const rows = accounts.data || accounts;
  const a1 = rows[0]?.code || "6002";
  const a2 = rows[1]?.code || "6001";
  await post("/api/v1/finance/journals", {
    voucherNo: `TEST-GP-${Date.now()}`, type: "journal",
    postingDate: new Date().toISOString().slice(0, 10),
    narration: "golden-path test", lines: [
      { accountCode: a1, debitMinor: 50000, creditMinor: 0 },
      { accountCode: a2, debitMinor: 0, creditMinor: 50000 },
    ],
  });
});

await test("tx: procurement indent create", async () => {
  await post("/api/v1/procurement/indents", {
    indentNo: `IND/GP/${Date.now()}`,
    department: "Finance", purpose: "golden-path test",
    items: [{ itemCode: "ITEM-001", description: "Test item", quantity: 1, unit: "nos", unitPriceMinor: 10000 }],
  });
});

await test("tx: leave apply (full chain: allocate + apply)", async () => {
  // Leave requires: (1) a real employee, (2) a real leave type, (3) an allocation.
  // Use the first seeded employee and the CL (Casual Leave) type; allocate, wait for
  // the CQRS consumer to persist, then apply.
  const empsJ = await get("/api/v1/hrms/employees?limit=1");
  const emps = empsJ.data || empsJ;
  if (!Array.isArray(emps) || emps.length === 0) throw new Error("no employees seeded");
  const empId = emps[0].id;

  const typesJ = await get("/api/v1/hrms/leave-types");
  const types = typesJ.data || typesJ;
  const cl = types.find(t => t.code === "CL") || types[0];
  if (!cl) throw new Error("no leave types seeded");

  // Allocate (idempotent — if already allocated, the endpoint may return the existing id)
  const allocRes = await post("/api/v1/hrms/leave-allocations", {
    employeeId: empId, leaveTypeId: cl.id, fy: "2026-27", totalDays: 12,
  });
  const allocId = allocRes.body?.id;
  if (!allocId) throw new Error("allocation not created: " + JSON.stringify(allocRes.body));

  // Wait for CQRS consumer to persist the allocation
  await new Promise(r => setTimeout(r, 2500));

  // Apply
  await post("/api/v1/hrms/leave-applications", {
    employeeId: empId, leaveTypeId: cl.id, allocId,
    fromDate: "2026-07-21", toDate: "2026-07-21", daysApplied: 1,
    reason: "golden-path automated test",
  });
});

await test("tx: payroll run create", async () => {
  const month = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const structs = await get("/api/v1/payroll/structures");
  const rows = structs.data || structs;
  const sid = rows[0]?.id || "test-struct";
  await post("/api/v1/payroll/runs", { runNo: `RUN/GP/${Date.now()}`, month, structureId: sid });
});

// ── ACTIVATION FUNNEL ──
await test("funnel: post signin event", () => post("/api/v1/analytics/activation/events", { step: "signin" }));
await test("funnel: post first_transaction event", () => post("/api/v1/analytics/activation/events", { step: "first_transaction" }));
await test("funnel: read (own office)", async () => {
  const j = await get("/api/v1/analytics/activation/funnel");
  if (!j.events || j.events.length === 0) throw new Error("no events returned");
});
await test("funnel: platform view", async () => {
  const j = await get("/api/v1/analytics/activation/funnel/platform");
  if (!j.events) throw new Error("no events array");
});

// ── REPORT ──
console.log("\n" + "═".repeat(72));
console.log("GOLDEN-PATH END-TO-END TEST RESULTS");
console.log("═".repeat(72));
const passed = results.filter(r => r.ok).length;
const failed = results.filter(r => !r.ok).length;
for (const r of results) {
  const icon = r.ok ? "✅" : "❌";
  console.log(`${icon}  ${r.name.padEnd(42)} ${String(r.ms).padStart(4)}ms${r.err ? `  — ${r.err}` : ""}`);
}
console.log("─".repeat(72));
console.log(`${passed} passed, ${failed} failed out of ${results.length} tests`);
if (failed > 0) process.exitCode = 1;
