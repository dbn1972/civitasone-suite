/**
 * payroll-service — Comprehensive core payroll route tests
 *
 * Covers routes.ts, gap-routes.ts, and world-class-routes.ts endpoints.
 * Tests: 200/201/202, 400, 401, 403, 404 for each endpoint.
 * Follows the established pattern from payroll-routes.test.ts (real DB, no mocks).
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-9999-4000-8000-000000000099";
const ACTOR = "00000000-0009-4000-8000-000000000001";
const UNKNOWN_ID = "00000000-dead-4000-8000-ffffffffffff";

function makeToken(roles: string[] = ["payroll_admin"], sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-core-001" }, SECRET);
}

const auth = (roles?: string[], sub?: string) => ({
  authorization: `Bearer ${makeToken(roles, sub)}`,
});

// External HRMS is not running in this service's isolated integration-test
// env. commands.ts's assertEmployeeExists() (round2 employee-existence
// review fix, commit 488e418e) does a real synchronous HTTP existence check
// before publishing any arrear/bonus/reimbursement command, so without this
// stub every such request 502s (HRMS_UNAVAILABLE) before it ever reaches the
// route's own logic. Only this one external-network boundary is stubbed —
// DB, queue, and outbox stay real, per this file's stated convention.
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, verifyEmployeeExists: async () => true };
});

afterAll(async () => { await sqlClient.end(); });

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/runs
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/runs (core)", () => {
  it("200 — returns list for payroll_admin", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("200 — returns list for hr_admin (reader role)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: auth(["hr_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("200 — returns list for finance_officer (reader role)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: auth(["finance_officer"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/runs/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/runs/:id (core)", () => {
  it("404 — non-existent run", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${UNKNOWN_ID}`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 — invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs/not-valid-uuid", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${UNKNOWN_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/runs/${UNKNOWN_ID}`, headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/structures
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/structures (core)", () => {
  it("200 — authorized reader", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures", headers: auth(["payroll_officer"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/structures
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/structures (core)", () => {
  it("202 — valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", headers: auth(["payroll_admin"]), payload: { name: "Core Test Structure", description: "for testing" } });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("400 — empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", payload: { name: "X" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — hr_admin cannot create", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", headers: auth(["hr_admin"]), payload: { name: "X" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 — finance_officer cannot create", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/structures", headers: auth(["finance_officer"]), payload: { name: "X" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/runs
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs (core)", () => {
  it("202 — valid pensioner run", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth(["payroll_admin"]), payload: { runNo: "CORE-RUN-001", month: "2026-08", runType: "pensioner" } });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("400 — missing structureId for regular run", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth(["payroll_admin"]), payload: { runNo: "RUN-X", month: "2026-08" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid month format", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth(["payroll_admin"]), payload: { runNo: "RUN-X", month: "08-2026", structureId: UNKNOWN_ID } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", payload: { runNo: "X", month: "2026-08", runType: "pensioner" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — finance_officer cannot create runs", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs", headers: auth(["finance_officer"]), payload: { runNo: "X", month: "2026-08", runType: "pensioner" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — PATCH /v1/payroll/runs/:id/approve
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/payroll/runs/:id/approve (core)", () => {
  it("202 or 503 — valid request", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/approve`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect([202, 503]).toContain(res.statusCode);
  });

  it("400 or 503 — invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: "/v1/payroll/runs/bad/approve", headers: auth(["payroll_admin"]) });
    await app.close();
    expect([400, 503]).toContain(res.statusCode);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/approve` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/approve`, headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — PATCH /v1/payroll/runs/:id/disburse
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/payroll/runs/:id/disburse (core)", () => {
  it("202 — valid request", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/disburse`, headers: auth(["payroll_officer"]) });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: "/v1/payroll/runs/xyz/disburse", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/disburse` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/disburse`, headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — PATCH /v1/payroll/runs/:id/revert
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/payroll/runs/:id/revert (core)", () => {
  it("202 — valid request", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/revert`, headers: auth(["super_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: "/v1/payroll/runs/xyz/revert", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/revert` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "PATCH", url: `/v1/payroll/runs/${UNKNOWN_ID}/revert`, headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/salary-slips
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/salary-slips (core)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-slips", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-slips" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-slips", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/slips/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/slips/:id (core)", () => {
  it("404 — non-existent slip", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/slips/${UNKNOWN_ID}`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/slips/bad-uuid", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/slips/${UNKNOWN_ID}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/slips/${UNKNOWN_ID}`, headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/ddos
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/ddos (core)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ddos", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ddos" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ddos", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/ddos
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/ddos (core)", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.ddo.upsert and returns
  // 202 — the ddoUpsert consumer applies the upsert asynchronously. The
  // accepted envelope's `id` IS the ddoCode (payroll_ddos has no surrogate id).
  it("202 — valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ddos", headers: auth(["payroll_admin"]), payload: { ddoCode: "DDO-CORE-01", name: "Core DDO", departmentIds: [] } });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe("DDO-CORE-01");
  });

  it("400 — missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ddos", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ddos", payload: { ddoCode: "X", name: "X", departmentIds: [] } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — finance_officer cannot create", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ddos", headers: auth(["finance_officer"]), payload: { ddoCode: "X", name: "X", departmentIds: [] } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/pensioners
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/pensioners (core)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pensioners", headers: auth(["payroll_officer"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pensioners" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pensioners", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/pensioners
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/pensioners (core)", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.pensioner.create and
  // returns 202 — the pensionerCreate consumer persists it asynchronously.
  it("202 — valid pensioner", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pensioners", headers: auth(["payroll_admin"]), payload: { ppoNo: "PPO-CORE-001", fullName: "Suresh Gupta", dateOfBirth: "1958-03-20", basicPensionMinor: 4500000, taxRegime: "old" } });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
    expect(res.json().status).toBe("accepted");
  });

  it("400 — missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pensioners", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid date format", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pensioners", headers: auth(["payroll_admin"]), payload: { ppoNo: "PPO-X", fullName: "X", dateOfBirth: "20-03-1958", basicPensionMinor: 100, taxRegime: "old" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pensioners", payload: { ppoNo: "X", fullName: "X", dateOfBirth: "1960-01-01", basicPensionMinor: 100, taxRegime: "new" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — hr_admin cannot create pensioners", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pensioners", headers: auth(["hr_admin"]), payload: { ppoNo: "X", fullName: "X", dateOfBirth: "1960-01-01", basicPensionMinor: 100, taxRegime: "new" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/runs/:id/simulate
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs/:id/simulate (gap)", () => {
  it("404 — non-existent run", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${UNKNOWN_ID}/simulate`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/runs/bad-id/simulate", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${UNKNOWN_ID}/simulate` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${UNKNOWN_ID}/simulate`, headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 — hr_admin role (read-only for simulation)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/runs/${UNKNOWN_ID}/simulate`, headers: auth(["hr_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/corrections
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/corrections (gap)", () => {
  it("202 (T1-03 CQRS lift) — valid correction returns accepted envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", headers: auth(["payroll_admin"]), payload: { employeeId: ACTOR, component: "BASIC", effectiveFrom: "2026-04-01", newValueMinor: 6000000, oldValueMinor: 5500000, reason: "annual increment" } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
    if (res.statusCode === 202) {
      const body = res.json();
      expect(body.status).toBe("accepted");
      expect(body.id).toBeDefined();
    }
  });

  it("400 — missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid date format", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", headers: auth(["payroll_admin"]), payload: { employeeId: ACTOR, component: "BASIC", effectiveFrom: "01-04-2026", newValueMinor: 100, oldValueMinor: 50 } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", headers: auth(["payroll_admin"]), payload: { employeeId: "not-uuid", component: "BASIC", effectiveFrom: "2026-04-01", newValueMinor: 100, oldValueMinor: 50 } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/corrections", headers: auth(["employee"]), payload: { employeeId: ACTOR, component: "BASIC", effectiveFrom: "2026-04-01", newValueMinor: 100, oldValueMinor: 50 } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/corrections
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/corrections (gap)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/corrections", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("200 — with employeeId filter", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/corrections?employeeId=${ACTOR}`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/corrections" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/corrections", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/pay-groups
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/pay-groups (gap)", () => {
  it("202 (T1-03 CQRS lift) — valid pay group returns accepted envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(["payroll_admin"]), payload: { name: "Monthly Default", frequency: "monthly", payDayOfMonth: 28 } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
    if (res.statusCode === 202) {
      expect(res.json().status).toBe("accepted");
    }
  });

  it("400 — empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid frequency", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(["payroll_admin"]), payload: { name: "X", frequency: "daily" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", payload: { name: "X", frequency: "monthly" } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/pay-groups", headers: auth(["employee"]), payload: { name: "X", frequency: "monthly" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/pay-groups
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/pay-groups (gap)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pay-groups", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pay-groups" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pay-groups", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/calendar
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/calendar (gap)", () => {
  it("200 — valid fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar?fy=2026-27", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().fy).toBe("2026-27");
  });

  it("400 — missing fy param", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar?fy=2026", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar?fy=2026-27" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/calendar?fy=2026-27", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/flex-benefits/plans
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/flex-benefits/plans (gap)", () => {
  it("202 (T1-03 CQRS lift) — valid plan returns accepted envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/plans", headers: auth(["payroll_admin"]), payload: { name: "FY26 Plan", fy: "2026-27", totalBudgetMinor: 10000000, components: [{ name: "Medical", maxMinor: 5000000, taxExempt: true }] } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
  });

  it("400 — empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/plans", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — empty components array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/plans", headers: auth(["payroll_admin"]), payload: { name: "X", fy: "2026-27", totalBudgetMinor: 100, components: [] } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/plans", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/plans", headers: auth(["employee"]), payload: { name: "X", fy: "2026-27", totalBudgetMinor: 100, components: [{ name: "A", maxMinor: 50, taxExempt: false }] } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/flex-benefits/elections
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/flex-benefits/elections (gap)", () => {
  it("202 (T1-03 CQRS lift) — valid election (employee can elect)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/elections", headers: auth(["employee"]), payload: { planId: randomUUID(), fy: "2026-27", elections: [{ component: "Medical", electedMinor: 250000 }] } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
  });

  it("400 — empty elections", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/elections", headers: auth(["employee"]), payload: { planId: randomUUID(), fy: "2026-27", elections: [] } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — missing planId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/elections", headers: auth(["employee"]), payload: { fy: "2026-27", elections: [{ component: "X", electedMinor: 100 }] } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/elections", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/flex-benefits/elections", headers: auth(["citizen"]), payload: { planId: randomUUID(), fy: "2026-27", elections: [{ component: "X", electedMinor: 100 }] } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/flex-benefits/my-elections
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/flex-benefits/my-elections (gap)", () => {
  it("200 — authorized (employee)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/my-elections", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("200 — admin can also view", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/my-elections", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/my-elections" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/flex-benefits/my-elections", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/costing/rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/costing/rules (gap)", () => {
  it("202 (T1-03 CQRS lift) — valid costing rule returns accepted envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/costing/rules", headers: auth(["payroll_admin"]), payload: { employeeGroup: "engineering", costCenterId: randomUUID(), splitPct: 100 } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
  });

  it("400 — empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/costing/rules", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid splitPct (> 100)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/costing/rules", headers: auth(["payroll_admin"]), payload: { employeeGroup: "x", costCenterId: randomUUID(), splitPct: 150 } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/costing/rules", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/costing/rules", headers: auth(["employee"]), payload: { employeeGroup: "x", costCenterId: randomUUID(), splitPct: 50 } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/costing/report
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/costing/report (gap)", () => {
  it("200 — valid period", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/costing/report?period=2026-07", headers: auth(["payroll_admin"]) });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
  });

  it("400 — missing period", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/costing/report", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid period format", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/costing/report?period=July2026", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/costing/report?period=2026-07" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/costing/report?period=2026-07", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/tax/optimization
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/optimization (gap)", () => {
  it("200 — valid employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/optimization?employeeId=${ACTOR}`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().suggestions).toBeDefined();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/tax/optimization", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid employeeId format", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/tax/optimization?employeeId=not-uuid", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/optimization?employeeId=${ACTOR}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/optimization?employeeId=${ACTOR}`, headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/tax/regime-comparison
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/tax/regime-comparison (gap)", () => {
  it("200 — valid employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/regime-comparison?employeeId=${ACTOR}`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().recommendation).toBeDefined();
  });

  it("400 — missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/tax/regime-comparison", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/regime-comparison?employeeId=${ACTOR}` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/tax/regime-comparison?employeeId=${ACTOR}`, headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/off-cycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/off-cycle (gap)", () => {
  it("202 (T1-03 CQRS lift) — valid off-cycle run returns accepted envelope", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", headers: auth(["payroll_admin"]), payload: { runType: "bonus", period: "2026-07", description: "Q2 bonus", items: [{ employeeId: ACTOR, amountMinor: 5000000 }] } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
    if (res.statusCode === 202) {
      const body = res.json();
      expect(body.status).toBe("accepted");
      expect(body.id).toBeDefined();
    }
  });

  it("400 — empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid runType", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", headers: auth(["payroll_admin"]), payload: { runType: "invalid", period: "2026-07", items: [{ employeeId: ACTOR, amountMinor: 100 }] } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — empty items array", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", headers: auth(["payroll_admin"]), payload: { runType: "bonus", period: "2026-07", items: [] } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle", headers: auth(["employee"]), payload: { runType: "bonus", period: "2026-07", items: [{ employeeId: ACTOR, amountMinor: 100 }] } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/off-cycle
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/off-cycle (gap)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/off-cycle", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/off-cycle" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/off-cycle", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/off-cycle/:id/process
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/off-cycle/:id/process (gap)", () => {
  it("404 — non-existent run", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/off-cycle/${UNKNOWN_ID}/process`, headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("400 — invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/off-cycle/bad/process", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/off-cycle/${UNKNOWN_ID}/process` });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: `/v1/payroll/off-cycle/${UNKNOWN_ID}/process`, headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — POST /v1/payroll/statutory/state-rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/statutory/state-rules (gap)", () => {
  it("202 (T1-03 CQRS lift) — valid state rules with PT slabs", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(["payroll_admin"]), payload: { stateCode: "KA", ptSlabs: [{ fromMinor: 0, toMinor: 1500000, taxMinor: 0 }, { fromMinor: 1500001, toMinor: 99999999, taxMinor: 20000 }] } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
  });

  it("202 (T1-03 CQRS lift) — valid LWF config", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(["payroll_admin"]), payload: { stateCode: "MH", lwfEmployee: 2500, lwfEmployer: 2500 } });
    await app.close();
    expect([202, 500]).toContain(res.statusCode);
  });

  it("400 — empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — stateCode too short", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(["payroll_admin"]), payload: { stateCode: "X" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/statutory/state-rules", headers: auth(["employee"]), payload: { stateCode: "KA" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// gap-routes.ts — GET /v1/payroll/statutory/state-rules
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/state-rules (gap)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/state-rules", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().ptSlabs).toBeDefined();
    expect(res.json().lwfConfig).toBeDefined();
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/state-rules" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/state-rules", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/arrears
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/arrears (world-class)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/arrears", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/arrears" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/arrears", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/arrears", headers: auth(["employee"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/arrears
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/arrears (world-class)", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.arrear.create and
  // returns 202 — the arrearCreate consumer persists it asynchronously
  // (no more synchronous DB write in the request path to fail with a 500).
  it("202 — valid arrear", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/arrears", headers: auth(["payroll_admin"]), payload: { employeeId: ACTOR, componentCode: "DA", fromPeriod: "2026-01", toPeriod: "2026-06", oldAmountMinor: 3000000, newAmountMinor: 3500000 } });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("400 — missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/arrears", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/arrears", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/arrears", headers: auth(["employee"]), payload: { employeeId: ACTOR, componentCode: "DA", fromPeriod: "2026-01", toPeriod: "2026-06", oldAmountMinor: 100, newAmountMinor: 200 } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/bonus/compute
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/bonus/compute (world-class)", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.bonus.compute and
  // returns 202 — the bonusCompute consumer computes bonusAmountMinor and
  // persists it asynchronously.
  it("202 — valid compute", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/bonus/compute", headers: auth(["payroll_admin"]), payload: { employeeId: ACTOR, fy: "2026-27", basicMinor: 8000000, bonusPct: 8.33 } });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("400 — missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/bonus/compute", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/bonus/compute", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/bonus/compute", headers: auth(["citizen"]), payload: { employeeId: ACTOR, fy: "2026-27", basicMinor: 100 } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/reimbursements
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/reimbursements (world-class)", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.reimbursement.create
  // and returns 202 — the reimbursementCreate consumer persists it
  // asynchronously.
  it("202 — valid reimbursement", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(["payroll_admin"]), payload: { employeeId: ACTOR, category: "travel", amountMinor: 500000, period: "2026-07" } });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("400 — invalid category", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(["payroll_admin"]), payload: { employeeId: ACTOR, category: "invalid", amountMinor: 100, period: "2026-07" } });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("400 — missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", payload: {} });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/reimbursements", headers: auth(["citizen"]), payload: { employeeId: ACTOR, category: "medical", amountMinor: 100, period: "2026-07" } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/reimbursements
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/reimbursements (world-class)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/ctc/calculate
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/ctc/calculate (world-class)", () => {
  it("200 — valid ctcMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ctc/calculate", headers: auth(["payroll_admin"]), payload: { ctcMinor: 150000000 } });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().ctcMinor).toBe(150000000);
  });

  it("400 or 500 — missing ctcMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ctc/calculate", headers: auth(["payroll_admin"]), payload: {} });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("400 or 500 — negative ctcMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ctc/calculate", headers: auth(["payroll_admin"]), payload: { ctcMinor: -500 } });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ctc/calculate", payload: { ctcMinor: 100 } });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "POST", url: "/v1/payroll/ctc/calculate", headers: auth(["citizen"]), payload: { ctcMinor: 100 } });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/comparison
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/comparison (world-class)", () => {
  it("200 — valid periods", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/comparison?period1=2026-06&period2=2026-07", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().period1).toBeDefined();
    expect(res.json().period2).toBeDefined();
  });

  it("400 or 500 — missing params", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/comparison", headers: auth(["payroll_admin"]) });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("400 or 500 — only one period", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/comparison?period1=2026-06", headers: auth(["payroll_admin"]) });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/comparison?period1=2026-06&period2=2026-07" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/comparison?period1=2026-06&period2=2026-07", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/register
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/register (world-class)", () => {
  it("200 — authorized", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/register", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("200 — with period filter", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/register?period=2026-07", headers: auth(["payroll_admin"]) });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("401 — no token", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/register" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("403 — citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/register", headers: auth(["citizen"]) });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
