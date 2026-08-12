import { createHmac } from "crypto";

// ─── JWT helper ────────────────────────────────────────────────────────────
const SECRET = "civitasone-dev-secret";
function mkTok(sub, tid, roles) {
  const hdr = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const pay = Buffer.from(JSON.stringify({
    sub, tid, tenantId: tid, roles,
    iss: "civitasone-dev", aud: "civitasone",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`${hdr}.${pay}`).digest("base64url");
  return `${hdr}.${pay}.${sig}`;
}

const TID = "00000000-0000-0000-0000-000000000001";
const EMP_ID = "00000000-0000-0000-0000-000000000002";
const ADMIN_TOK  = mkTok("00000000-0000-0000-0000-000000000010", TID, ["payroll_admin", "super_admin"]);
const READER_TOK = mkTok("00000000-0000-0000-0000-000000000011", TID, ["hr_admin"]);
const ANON_TOK   = "";

const BASE = "http://localhost:3013";
let passed = 0, failed = 0;
const results = [];

async function req(method, path, { token = ADMIN_TOK, body, expectedStatus } = {}) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

function test(name, fn) {
  return fn().then(() => {
    console.log(`  PASS  ${name}`);
    results.push({ name, pass: true });
    passed++;
  }).catch((e) => {
    console.log(`  FAIL  ${name}: ${e.message}`);
    results.push({ name, pass: false, err: e.message });
    failed++;
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

console.log("\n=== Payroll Service Live Tests ===\n");

// ── P1: Health check ──────────────────────────────────────────────────────
await test("Health endpoint returns 200 ok", async () => {
  const r = await req("GET", "/health", { token: "" });
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body.status === "ok", "expected status ok");
});

// ── P2: Auth guard — anon gets 401 ───────────────────────────────────────
await test("GET /v1/payroll/runs — anon → 401", async () => {
  const r = await req("GET", "/v1/payroll/runs", { token: ANON_TOK });
  assert(r.status === 401, `expected 401 got ${r.status}`);
});

// ── P3: Auth guard — wrong role gets 403 ─────────────────────────────────
await test("GET /v1/payroll/runs — unknown-role → 403", async () => {
  const badTok = mkTok("00000000-0000-0000-0000-000000000099", TID, ["citizen"]);
  const r = await req("GET", "/v1/payroll/runs", { token: badTok });
  assert(r.status === 403, `expected 403 got ${r.status}`);
});

// ── P4: Payroll runs list ─────────────────────────────────────────────────
await test("GET /v1/payroll/runs → 200 with data array", async () => {
  const r = await req("GET", "/v1/payroll/runs");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(Array.isArray(r.body?.data ?? r.body), "expected data array");
});

// ── P5: Payroll structures list ───────────────────────────────────────────
await test("GET /v1/payroll/structures → 200", async () => {
  const r = await req("GET", "/v1/payroll/structures");
  assert(r.status === 200, `expected 200 got ${r.status}`);
});

// ── P6: Payroll components list ───────────────────────────────────────────
await test("GET /v1/payroll/components → 200 with meta", async () => {
  const r = await req("GET", "/v1/payroll/components");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.meta !== undefined, "expected meta field");
});

// ── P7: Salary slips list ─────────────────────────────────────────────────
await test("GET /v1/payroll/salary-slips → 200", async () => {
  const r = await req("GET", "/v1/payroll/salary-slips");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(Array.isArray(r.body?.data ?? r.body), "expected array response");
});

// ── P8: Reader role can access runs ──────────────────────────────────────
await test("GET /v1/payroll/runs — hr_admin reader → 200", async () => {
  const r = await req("GET", "/v1/payroll/runs", { token: READER_TOK });
  assert(r.status === 200, `expected 200 got ${r.status}`);
});

// ── P9: Run not found returns 404 ────────────────────────────────────────
await test("GET /v1/payroll/runs/non-existent-id → 400 or 404", async () => {
  const r = await req("GET", "/v1/payroll/runs/deadbeef-dead-dead-dead-deadbeefdead");
  assert([400, 404].includes(r.status), `expected 400/404 got ${r.status}`);
});

// ── P10: Statutory — PF ───────────────────────────────────────────────────
await test("GET /v1/payroll/statutory/pf → 200", async () => {
  const r = await req("GET", "/v1/payroll/statutory/pf");
  assert(r.status === 200, `expected 200 got ${r.status}`);
});

// ── P11: Statutory — ESI ──────────────────────────────────────────────────
await test("GET /v1/payroll/statutory/esi → 200", async () => {
  const r = await req("GET", "/v1/payroll/statutory/esi");
  assert(r.status === 200, `expected 200 got ${r.status}`);
});

// ── P12: Statutory — GPF ──────────────────────────────────────────────────
await test("GET /v1/payroll/statutory/gpf → 200", async () => {
  const r = await req("GET", "/v1/payroll/statutory/gpf");
  assert(r.status === 200, `expected 200 got ${r.status}`);
});

// ── P13: Statutory — TDS ──────────────────────────────────────────────────
await test("GET /v1/payroll/statutory/tds → 200", async () => {
  const r = await req("GET", "/v1/payroll/statutory/tds");
  assert(r.status === 200, `expected 200 got ${r.status}`);
});

// ── P14: Arrears list (world-class-routes) ────────────────────────────────
await test("GET /v1/payroll/arrears → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/arrears");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P15: Reimbursements list ──────────────────────────────────────────────
await test("GET /v1/payroll/reimbursements → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/reimbursements");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P16: Salary revisions list (read) ────────────────────────────────────
await test("GET /v1/payroll/salary-revisions → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/salary-revisions");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P17: Payroll register ──────────────────────────────────────────────────
await test("GET /v1/payroll/register → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/register");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P18: NEW — YTD summary ────────────────────────────────────────────────
await test("GET /v1/payroll/ytd → 200 with YTD fields", async () => {
  const r = await req("GET", `/v1/payroll/ytd?employeeId=${EMP_ID}`);
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert("ytdGrossMinor" in r.body, "expected ytdGrossMinor field");
  assert("monthsProcessed" in r.body, "expected monthsProcessed field");
  assert("breakdown" in r.body, "expected breakdown array");
});

// ── P19: NEW — Payroll settings GET ──────────────────────────────────────
await test("GET /v1/payroll/settings → 200 with protectedNetFloorMinor", async () => {
  const r = await req("GET", "/v1/payroll/settings");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert("protectedNetFloorMinor" in r.body, "expected protectedNetFloorMinor");
});

// ── P20: NEW — Payroll settings PUT ──────────────────────────────────────
await test("PUT /v1/payroll/settings → 200 upserts floor value", async () => {
  const r = await req("PUT", "/v1/payroll/settings", { body: { protectedNetFloorMinor: 1000000 } });
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.protectedNetFloorMinor === 1000000, "expected value echo");
});

// ── P21: NEW — Salary revision create ────────────────────────────────────
await test("POST /v1/payroll/salary-revisions → 201 creates revision", async () => {
  const r = await req("POST", "/v1/payroll/salary-revisions", {
    body: {
      employeeId:    EMP_ID,
      effectiveDate: "2026-04-01",
      oldBasicMinor: 2000000,
      newBasicMinor: 2200000,
      oldGrossMinor: 4000000,
      newGrossMinor: 4400000,
      revisionType:  "annual_increment",
      orderNo:       "DPC/2026/001",
    },
  });
  assert(r.status === 201, `expected 201 got ${r.status} — ${JSON.stringify(r.body)}`);
  assert(r.body?.id, "expected id in response");
});

// ── P22: Loans list requires empId ───────────────────────────────────────
await test("GET /v1/payroll/loans — missing empId → 400", async () => {
  const r = await req("GET", "/v1/payroll/loans");
  assert(r.status === 400, `expected 400 got ${r.status}`);
});

// ── P23: NEW — Loan not found returns 404 ────────────────────────────────
await test("GET /v1/payroll/loans/:id — non-existent → 404", async () => {
  const r = await req("GET", `/v1/payroll/loans/${EMP_ID}`);  // random UUID, no loan
  assert(r.status === 404, `expected 404 got ${r.status}`);
});

// ── P24: NEW — Loan schedule not found returns 404 ───────────────────────
await test("GET /v1/payroll/loans/:id/schedule — non-existent → 404", async () => {
  const r = await req("GET", `/v1/payroll/loans/${EMP_ID}/schedule`);
  assert(r.status === 404, `expected 404 got ${r.status}`);
});

// ── P25: Off-cycle runs list ──────────────────────────────────────────────
await test("GET /v1/payroll/off-cycle → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/off-cycle");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P26: Pay groups list ──────────────────────────────────────────────────
await test("GET /v1/payroll/pay-groups → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/pay-groups");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P27: Costing rules list ───────────────────────────────────────────────
await test("GET /v1/payroll/costing/rules → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/costing/rules");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P28: DDOs list ────────────────────────────────────────────────────────
await test("GET /v1/payroll/ddos → 200", async () => {
  const r = await req("GET", "/v1/payroll/ddos");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(Array.isArray(r.body), "expected array");
});

// ── P29: Pensioners list ──────────────────────────────────────────────────
await test("GET /v1/payroll/pensioners → 200", async () => {
  const r = await req("GET", "/v1/payroll/pensioners");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(Array.isArray(r.body), "expected array");
});

// ── P30: Tax declarations list ────────────────────────────────────────────
await test("GET /v1/payroll/tax-declarations → 200", async () => {
  const r = await req("GET", `/v1/payroll/tax-declarations?employeeId=${EMP_ID}&fy=2025-26`);
  assert(r.status === 200, `expected 200 got ${r.status}`);
});

// ── P31: Bonus list ───────────────────────────────────────────────────────
await test("GET /v1/payroll/bonus → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/bonus");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P32: PT statutory list ────────────────────────────────────────────────
await test("GET /v1/payroll/statutory/pt → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/statutory/pt");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// ── P33: LWF statutory list ───────────────────────────────────────────────
await test("GET /v1/payroll/statutory/lwf → 200 with data", async () => {
  const r = await req("GET", "/v1/payroll/statutory/lwf");
  assert(r.status === 200, `expected 200 got ${r.status}`);
  assert(r.body?.data !== undefined, "expected data field");
});

// Summary
console.log(`\n╔═══════════════════════════════════════╗`);
console.log(`║  Results: ${passed}/${passed + failed} PASS                    ║`);
if (failed > 0) {
  console.log(`║  Failed:  ${failed}                            ║`);
  results.filter(r => !r.pass).forEach(r => console.log(`║    ✗ ${r.name.slice(0,38).padEnd(38)} ║`));
}
console.log(`╚═══════════════════════════════════════╝`);
process.exit(failed > 0 ? 1 : 0);
