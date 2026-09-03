/**
 * payroll-service — Core payroll routes + world-class-routes integration tests.
 *
 * Covers routes.ts endpoints:
 *   GET  /v1/payroll/runs, /v1/payroll/runs/:id, /v1/payroll/structures,
 *        /v1/payroll/salary-slips, /v1/payroll/slips/:id,
 *        /v1/payroll/ddos, /v1/payroll/pensioners
 *   POST /v1/payroll/structures, /v1/payroll/runs,
 *        /v1/payroll/ddos, /v1/payroll/pensioners
 *   PATCH /v1/payroll/runs/:id/approve, /v1/payroll/runs/:id/disburse,
 *         /v1/payroll/runs/:id/revert
 *
 * Covers world-class-routes.ts endpoints:
 *   GET/POST /v1/payroll/arrears, /v1/payroll/bonus, /v1/payroll/bonus/compute,
 *            /v1/payroll/statutory/pt, /v1/payroll/statutory/lwf,
 *            /v1/payroll/reimbursements, /v1/payroll/salary-revisions,
 *            /v1/payroll/register, /v1/payroll/ctc/config,
 *            /v1/payroll/ctc/calculate, /v1/payroll/comparison
 */
import { describe, it, expect, vi, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-7777-4000-8000-000000000099";
const ACTOR = "00000000-0002-4000-8000-000000000001";
const UNKNOWN_ID = "00000000-dead-4000-8000-000000000099";

function makeToken(roles: string[] = ["payroll_admin"], sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles, sid: "sess-pay-001" }, SECRET);
}

const authHeader = (roles?: string[], sub?: string) => ({
  authorization: `Bearer ${makeToken(roles, sub)}`,
});

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

// External HRMS is not running in this service's isolated integration-test
// env. commands.ts's assertEmployeeExists() (round2 employee-existence
// review fix, commit 488e418e) does a real synchronous HTTP existence check
// before publishing any arrear/bonus/reimbursement command, so without this
// stub every such request 502s (HRMS_UNAVAILABLE) before it ever reaches the
// route's own logic. Only this one external-network boundary is stubbed —
// DB, queue, and outbox stay real.
vi.mock("../src/shared/hrms-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/shared/hrms-client.js")>();
  return { ...actual, verifyEmployeeExists: async () => true };
});

afterAll(async () => { await sqlClient.end(); });

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/runs
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/runs", () => {
  it("returns 200 with list for authorized user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/runs" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/runs/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/runs/:id", () => {
  it("returns 404 for non-existent run", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${UNKNOWN_ID}`,
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/runs/not-a-uuid",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${UNKNOWN_ID}`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${UNKNOWN_ID}`,
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/structures
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/structures", () => {
  it("returns 200 for authorized user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/structures",
      headers: authHeader(["hr_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/structures" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/structures",
      headers: authHeader(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/structures
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/structures", () => {
  it("returns 202 for valid body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/structures",
      headers: authHeader(["payroll_admin"]),
      payload: { name: "Standard Structure", description: "Default pay structure" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
  });

  it("returns 400 for empty body", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/structures",
      headers: authHeader(["payroll_admin"]),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/structures",
      payload: { name: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for reader-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/structures",
      headers: authHeader(["hr_admin"]),
      payload: { name: "Test" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/runs
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs", () => {
  it("returns 202 for valid pensioner run", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: authHeader(["payroll_admin"]),
      payload: { runNo: "RUN-2026-07", month: "2026-07", runType: "pensioner" },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 when structureId missing for regular run", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: authHeader(["payroll_admin"]),
      payload: { runNo: "RUN-001", month: "2026-07" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid month format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: authHeader(["payroll_admin"]),
      payload: { runNo: "RUN-001", month: "07-2026", structureId: UNKNOWN_ID },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      payload: { runNo: "RUN-001", month: "2026-07", runType: "pensioner" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for finance_officer (reader only for runs)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: authHeader(["finance_officer"]),
      payload: { runNo: "RUN-001", month: "2026-07", runType: "pensioner" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — PATCH /v1/payroll/runs/:id/approve
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/payroll/runs/:id/approve", () => {
  it("returns 202 or 503 for valid approve request (permission check may need external service)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/approve`,
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    // 202 when permission service is available; 503 when external auth service is unreachable
    expect([202, 503]).toContain(res.statusCode);
  });

  it("returns 400 or 503 for invalid UUID", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/v1/payroll/runs/bad-id/approve",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    // 400 from zod parse, or 503 if permission check runs first
    expect([400, 503]).toContain(res.statusCode);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/approve`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/approve`,
      headers: authHeader(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — PATCH /v1/payroll/runs/:id/disburse
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/payroll/runs/:id/disburse", () => {
  it("returns 202 for valid request", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/disburse`,
      headers: authHeader(["payroll_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/disburse`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/disburse`,
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — PATCH /v1/payroll/runs/:id/revert
// ═══════════════════════════════════════════════════════════════════════════════

describe("PATCH /v1/payroll/runs/:id/revert", () => {
  it("returns 202 for valid request", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/revert`,
      headers: authHeader(["super_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(202);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/revert`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${UNKNOWN_ID}/revert`,
      headers: authHeader(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/salary-slips
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/salary-slips", () => {
  it("returns 200 for authorized user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-slips",
      headers: authHeader(["finance_officer"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-slips" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-slips",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/slips/:id
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/slips/:id", () => {
  it("returns 404 for non-existent slip", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${UNKNOWN_ID}`,
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/slips/invalid",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${UNKNOWN_ID}`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${UNKNOWN_ID}`,
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/ddos
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/ddos", () => {
  it("returns 200 for authorized user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/ddos",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ddos" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/ddos",
      headers: authHeader(["employee"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/ddos
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/ddos", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.ddo.upsert and returns
  // 202 — the accepted envelope's `id` IS the ddoCode (no surrogate id).
  it("returns 202 for valid DDO creation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ddos",
      headers: authHeader(["payroll_admin"]),
      payload: { ddoCode: "DDO-001", name: "Test DDO", departmentIds: [] },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe("DDO-001");
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ddos",
      headers: authHeader(["payroll_admin"]),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ddos",
      payload: { ddoCode: "DDO-001", name: "Test DDO" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for reader-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ddos",
      headers: authHeader(["finance_officer"]),
      payload: { ddoCode: "DDO-001", name: "Test DDO" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — GET /v1/payroll/pensioners
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/pensioners", () => {
  it("returns 200 for authorized user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/pensioners",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/pensioners" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/pensioners",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// routes.ts — POST /v1/payroll/pensioners
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/pensioners", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.pensioner.create and
  // returns 202 — the accepted envelope has no ppoNo (only id/status).
  it("returns 202 for valid pensioner creation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/pensioners",
      headers: authHeader(["payroll_admin"]),
      payload: {
        ppoNo: "PPO-0001",
        fullName: "Ramesh Kumar",
        dateOfBirth: "1960-05-15",
        basicPensionMinor: 5000000,
        taxRegime: "old",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
    expect(res.json().status).toBe("accepted");
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/pensioners",
      headers: authHeader(["payroll_admin"]),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid date format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/pensioners",
      headers: authHeader(["payroll_admin"]),
      payload: {
        ppoNo: "PPO-0002",
        fullName: "Test",
        dateOfBirth: "15-05-1960",
        basicPensionMinor: 5000000,
        taxRegime: "old",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/pensioners",
      payload: { ppoNo: "PPO-0003", fullName: "Test", dateOfBirth: "1960-01-01", basicPensionMinor: 1000, taxRegime: "new" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for reader-only role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/pensioners",
      headers: authHeader(["hr_admin"]),
      payload: { ppoNo: "PPO-0004", fullName: "Test", dateOfBirth: "1960-01-01", basicPensionMinor: 1000, taxRegime: "new" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/arrears
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/arrears", () => {
  it("returns 200 with data for authorized user", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/arrears",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/arrears" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/arrears",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/arrears
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/arrears", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.arrear.create and
  // returns 202 — no synchronous DB write left in the request path.
  it("returns 202 for valid arrear creation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/arrears",
      headers: authHeader(["payroll_admin"]),
      payload: {
        employeeId: ACTOR,
        componentCode: "BASIC",
        fromPeriod: "2026-01",
        toPeriod: "2026-06",
        oldAmountMinor: 5000000,
        newAmountMinor: 5500000,
        reason: "increment arrear",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("returns 400 for missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/arrears",
      headers: authHeader(["payroll_admin"]),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/arrears",
      payload: { employeeId: ACTOR, componentCode: "BASIC", fromPeriod: "2026-01", toPeriod: "2026-06", oldAmountMinor: 100, newAmountMinor: 200 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/arrears",
      headers: authHeader(["employee"]),
      payload: { employeeId: ACTOR, componentCode: "BASIC", fromPeriod: "2026-01", toPeriod: "2026-06", oldAmountMinor: 100, newAmountMinor: 200 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/bonus
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/bonus", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/bonus",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/bonus" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/bonus",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/bonus/compute
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/bonus/compute", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.bonus.compute and
  // returns 202 — bonusAmountMinor is now computed inside the consumer.
  it("returns 202 for valid bonus computation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/bonus/compute",
      headers: authHeader(["payroll_admin"]),
      payload: { employeeId: ACTOR, fy: "2025-26", basicMinor: 6000000, bonusPct: 8.33 },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("returns 400 for missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/bonus/compute",
      headers: authHeader(["payroll_admin"]),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/bonus/compute",
      payload: { employeeId: ACTOR, fy: "2025-26", basicMinor: 6000000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/bonus/compute",
      headers: authHeader(["citizen"]),
      payload: { employeeId: ACTOR, fy: "2025-26", basicMinor: 6000000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/statutory/pt
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/pt", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pt",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/pt" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/pt",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/statutory/lwf
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/lwf", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/lwf",
      headers: authHeader(["hr_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/statutory/lwf" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/lwf",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/reimbursements
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/reimbursements", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/reimbursements",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/reimbursements" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/reimbursements",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/reimbursements
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/reimbursements", () => {
  // CQRS lift (quality-payroll-95): publishes payroll.reimbursement.create
  // and returns 202 instead of inserting synchronously.
  it("returns 202 for valid reimbursement", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: authHeader(["payroll_admin"]),
      payload: {
        employeeId: ACTOR,
        category: "medical",
        amountMinor: 250000,
        period: "2026-07",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBeDefined();
  });

  it("returns 400 for invalid category", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: authHeader(["payroll_admin"]),
      payload: {
        employeeId: ACTOR,
        category: "invalid_cat",
        amountMinor: 250000,
        period: "2026-07",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for missing fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: authHeader(["payroll_admin"]),
      payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      payload: { employeeId: ACTOR, category: "medical", amountMinor: 100, period: "2026-07" },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: authHeader(["citizen"]),
      payload: { employeeId: ACTOR, category: "medical", amountMinor: 100, period: "2026-07" },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/salary-revisions
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/salary-revisions", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-revisions",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/salary-revisions" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/salary-revisions",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/register
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/register", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/register",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/register" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/register",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/ctc/config
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/ctc/config", () => {
  it("returns 200 with data", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/ctc/config",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toBeDefined();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/v1/payroll/ctc/config" });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/ctc/config",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — POST /v1/payroll/ctc/calculate
// ═══════════════════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/ctc/calculate", () => {
  it("returns 200 for valid CTC computation", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ctc/calculate",
      headers: authHeader(["payroll_admin"]),
      payload: { ctcMinor: 120000000 },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().ctcMinor).toBe(120000000);
  });

  it("returns 400 or 500 for missing ctcMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ctc/calculate",
      headers: authHeader(["payroll_admin"]),
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 400 or 500 for negative ctcMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ctc/calculate",
      headers: authHeader(["payroll_admin"]),
      payload: { ctcMinor: -100 },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ctc/calculate",
      payload: { ctcMinor: 100000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ctc/calculate",
      headers: authHeader(["citizen"]),
      payload: { ctcMinor: 100000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// world-class-routes.ts — GET /v1/payroll/comparison
// ═══════════════════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/comparison", () => {
  it("returns 200 for valid periods", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/comparison?period1=2026-06&period2=2026-07",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().period1).toBeDefined();
    expect(res.json().period2).toBeDefined();
  });

  it("returns 400 or 500 for missing period params", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/comparison",
      headers: authHeader(["payroll_admin"]),
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/comparison?period1=2026-06&period2=2026-07",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for unauthorized role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/comparison?period1=2026-06&period2=2026-07",
      headers: authHeader(["citizen"]),
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
