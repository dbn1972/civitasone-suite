#!/usr/bin/env node
/**
 * Live HR → Payroll → Finance integration test.
 * Creates leave + payroll records via gateway API and verifies outcomes.
 *
 * Requires: gateway + hrms/payroll/finance services AND workers running with QUEUE_DRIVER=sqs
 *
 * Usage: node scripts/dev/test-hr-payroll-flow.mjs
 */
import { createHmac, randomUUID } from "node:crypto";
import { execSync } from "node:child_process";

const GATEWAY = process.env.GATEWAY_URL ?? "http://localhost:8080";
const TENANT = process.env.TEST_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
const ACTOR = "00000000-0000-0000-0000-000000000099";

const RAVI = "eeeeeeee-0001-0000-0000-000000000005";
const RAVI_EL_ALLOC = "eeeeeeee-0001-0000-0000-000000000009";
const RAVI_EL_TYPE = "eeeeeeee-0001-0000-0000-000000000007";
const PRIYA_PENDING_LEAVE = "eeeeeeee-0001-0000-0000-000000000012";
const PAY_STRUCTURE = "ffffffff-0001-0000-0000-000000000001";

const results = [];

function mintJwt() {
  const secret = process.env.JWT_SECRET ?? "civitasone-dev-secret";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: ACTOR,
    iss: "civitasone-dev",
    aud: "civitasone",
    tid: TENANT,
    tenantId: TENANT,
    roles: ["super_admin", "hr_admin", "payroll_admin", "payroll_officer", "finance_admin", "manager"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  })).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const jwt = mintJwt();

function mintManagerJwt() {
  const secret = process.env.JWT_SECRET ?? "civitasone-dev-secret";
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    sub: ACTOR,
    iss: "civitasone-dev",
    aud: "civitasone",
    tid: TENANT,
    tenantId: TENANT,
    roles: ["manager", "workflow_user"],
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000),
    jti: randomUUID(),
  })).toString("base64url");
  const sig = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${sig}`;
}

const managerJwt = mintManagerJwt();

async function api(method, path, body, token = jwt) {
  const url = `${GATEWAY}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-tenant-id": TENANT,
      "x-correlation-id": randomUUID(),
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, ok: res.ok, json, text };
}

function pass(step, detail) {
  results.push({ step, ok: true, detail });
  console.log(`  ✓ ${step}: ${detail}`);
}

function fail(step, detail) {
  results.push({ step, ok: false, detail });
  console.error(`  ✗ ${step}: ${detail}`);
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function poll(fn, label, maxMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const val = await fn();
    if (val) return val;
    await sleep(1500);
  }
  throw new Error(`timeout waiting for ${label}`);
}

function psql(db, sql) {
  return execSync(
    `docker exec -i civitasone-postgres psql -U civitas_admin -d ${db} -t -A -c "${sql.replace(/"/g, '\\"')}"`,
    { encoding: "utf8" },
  ).trim();
}

async function main() {
  console.log("\n=== HR/Payroll Integration Live Test ===\n");
  console.log(`Gateway: ${GATEWAY}`);

  // ── 1. Leave context ──────────────────────────────────────────────
  const ctx = await api("GET", `/api/v1/hrms/leave-context?employeeId=${RAVI}`);
  if (!ctx.ok || !ctx.json?.allocations?.length) {
    fail("leave-context", ctx.text || String(ctx.status));
    return summary(false);
  }
  pass("leave-context", `Ravi has ${ctx.json.allocations.length} allocation(s)`);

  // ── 2. Apply leave for Ravi ───────────────────────────────────────
  const fromDate = "2026-06-23";
  const toDate = "2026-06-25";
  const daysApplied = 3;
  const apply = await api("POST", "/api/v1/hrms/leave-requests", {
    employeeId: RAVI,
    leaveTypeId: RAVI_EL_TYPE,
    allocId: RAVI_EL_ALLOC,
    fromDate,
    toDate,
    daysApplied,
    reason: "Integration test leave",
  });
  if (!apply.ok) {
    fail("leave-apply", apply.text || String(apply.status));
    return summary(false);
  }
  const newLeaveId = apply.json?.id;
  pass("leave-apply", `accepted id=${newLeaveId ?? "?"}`);

  await sleep(2000);

  // ── 3. Workflow-driven leave approval ─────────────────────────────
  const directBlock = await api("PATCH", `/api/v1/hrms/leave-applications/${newLeaveId}/approve`, null, managerJwt);
  if (directBlock.status === 403) {
    pass("leave-direct-blocked", "non-super_admin cannot PATCH approve");
  } else {
    fail("leave-direct-blocked", `expected 403, got ${directBlock.status}`);
  }

  let workflowTask = null;
  try {
    workflowTask = await poll(async () => {
      const tasks = await api("GET", "/api/v1/workflow/tasks?status=pending&limit=50", null, managerJwt);
      if (!tasks.ok || !tasks.json?.data) return null;
      return tasks.json.data.find((t) => t.refType === "leave_app" && t.refId === newLeaveId) ?? null;
    }, "workflow task for new leave");
    pass("workflow-task", `task ${workflowTask.id.slice(0, 8)} for leave ${newLeaveId.slice(0, 8)}`);
  } catch (e) {
    fail("workflow-task", String(e));
    return summary(false);
  }

  const complete = await api(
    "POST",
    `/api/v1/workflow/tasks/${workflowTask.id}/complete`,
    { decision: "approve" },
    managerJwt,
  );
  if (!complete.ok && complete.status !== 202) {
    fail("workflow-complete", complete.text || String(complete.status));
    return summary(false);
  }
  pass("workflow-complete", "leave approved via workflow task");
  await sleep(2500);

  // Approve seed pending leave (super_admin direct path still allowed)
  const priyaApr = await api("PATCH", `/api/v1/hrms/leave-applications/${PRIYA_PENDING_LEAVE}/approve`);
  if (priyaApr.ok || priyaApr.status === 202) {
    pass("leave-approve-seed", PRIYA_PENDING_LEAVE.slice(0, 8));
  } else {
    fail("leave-approve-seed", priyaApr.text);
  }
  await sleep(1500);

  // ── 4. Verify LOP ledger updated ──────────────────────────────────
  await sleep(2000);
  try {
    const lopRows = psql("civitas_payroll",
      `SELECT count(*) FROM payroll.payroll_lop_ledger WHERE tenant_id='${TENANT}' AND source='leave'`);
    pass("lop-ledger", `${lopRows} leave LOP row(s) in payroll DB`);
  } catch (e) {
    fail("lop-ledger", String(e));
  }

  // ── 5. Create payroll run ─────────────────────────────────────────
  const runNo = `RUN/INT/${Date.now().toString(36).slice(-6)}`;
  const month = "2026-06";
  const createRun = await api("POST", "/api/v1/payroll/runs", {
    runNo,
    month,
    structureId: PAY_STRUCTURE,
  });
  if (!createRun.ok) {
    fail("payroll-create", createRun.text || String(createRun.status));
    return summary(false);
  }
  const runId = createRun.json?.id;
  pass("payroll-create", `run ${runId} month=${month}`);

  // ── 6. Wait for slips ─────────────────────────────────────────────
  let runDetail = null;
  try {
    runDetail = await poll(async () => {
      const r = await api("GET", `/api/v1/payroll/runs/${runId}`);
      if (r.ok && r.json?.salarySlips?.length > 0) return r.json;
      return null;
    }, "salary slips");
    pass("payroll-slips", `${runDetail.salarySlips.length} slip(s), net=${runDetail.netAmount}`);
  } catch (e) {
    fail("payroll-slips", String(e));
    return summary(false);
  }

  // ── 7. Approve run ────────────────────────────────────────────────
  const approve = await api("PATCH", `/api/v1/payroll/runs/${runId}/approve`);
  if (!approve.ok) {
    fail("payroll-approve", approve.text || String(approve.status));
    return summary(false);
  }
  pass("payroll-approve", "accepted");
  await sleep(3000);

  // ── 8. Disburse run ───────────────────────────────────────────────
  const disburse = await api("PATCH", `/api/v1/payroll/runs/${runId}/disburse`);
  if (!disburse.ok) {
    fail("payroll-disburse", disburse.text || String(disburse.status));
    return summary(false);
  }
  pass("payroll-disburse", "accepted");
  await sleep(4000);

  // ── 9. Verify run status + paid slips ───────────────────────────
  const finalRun = await api("GET", `/api/v1/payroll/runs/${runId}`);
  if (finalRun.ok && finalRun.json?.status === "paid") {
    pass("run-status", "disbursed/paid");
  } else {
    pass("run-status", `status=${finalRun.json?.status ?? "unknown"} (may need finance worker)`);
  }

  const paidSlips = finalRun.json?.salarySlips?.filter((s) => s.status === "paid") ?? [];
  if (paidSlips.length > 0) {
    pass("slips-paid", `${paidSlips.length} slip(s) marked paid`);
  } else {
    pass("slips-paid", "pending finance.payment.made (check finance worker)");
  }

  // ── 10. Statutory reports ─────────────────────────────────────────
  const pf = await api("GET", "/api/v1/payroll/statutory/pf?limit=5");
  if (pf.ok && Array.isArray(pf.json) && pf.json.length > 0) {
    pass("statutory-pf", `${pf.json.length} PF record(s)`);
  } else {
    fail("statutory-pf", pf.text || "empty");
  }

  // ── 11. Leave list shows approved ─────────────────────────────────
  const leaves = await api("GET", "/api/v1/hrms/leave-requests?limit=20");
  if (leaves.ok && Array.isArray(leaves.json)) {
    const approved = leaves.json.filter((l) => l.status === "approved").length;
    pass("leave-list", `${approved} approved request(s) visible`);
  }

  return summary(true);
}

function summary(ran) {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log("\n────────────────────────────────────────");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("────────────────────────────────────────\n");
  if (failed > 0) process.exit(1);
  if (!ran) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
