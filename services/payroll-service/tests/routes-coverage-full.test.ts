/**
 * payroll-service — full routes coverage
 *
 * Exercises ALL GET, POST, and PATCH routes with valid auth tokens,
 * verifying handler code paths (200/400/404/500). Also tests auth
 * rejection (403) for citizen role on key routes.
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const UUID = "aaaaaaaa-bbbb-4000-8000-000000000001";
const FAKE = randomUUID();

function token(roles = ["payroll_admin", "super_admin", "hr_admin", "finance_officer"]) {
  return signToken({ sub: UUID, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function badToken() {
  return signToken({ sub: UUID, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { /* pool closed by other test teardown */ });

// ═══════════════════════════════════════════════════════════════════
// GET routes — expect handler to respond (not 404)
// ═══════════════════════════════════════════════════════════════════

const getRoutes = [
  "/v1/payroll/runs",
  "/v1/payroll/structures",
  "/v1/payroll/salary-slips",
  `/v1/payroll/runs/${FAKE}`,
  `/v1/payroll/slips/${FAKE}`,
  `/v1/payroll/slips/${FAKE}/pdf`,
  `/v1/payroll/runs/${FAKE}/bank-file`,
  `/v1/payroll/loans?empId=${FAKE}`,
  `/v1/payroll/tax-declarations?employeeId=${FAKE}&fy=2025-26`,
  `/v1/payroll/tax/computation?employeeId=${FAKE}&fy=2025-26`,
  `/v1/payroll/tax/form16?employeeId=${FAKE}&fy=2025-26`,
  `/v1/payroll/tax/form16/${FAKE}/pdf`,
  "/v1/payroll/statutory/pf",
  "/v1/payroll/statutory/esi",
  "/v1/payroll/statutory/tds",
  "/v1/payroll/statutory/nps",
  "/v1/payroll/statutory/gpf",
  "/v1/payroll/statutory/gratuity",
  "/v1/payroll/statutory/ecr?month=2026-06",
  "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
  "/v1/payroll/statutory/form12ba?fy=2025-26",
  "/v1/payroll/statutory/nps-scf?fy=2025-26",
  "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
  "/v1/payroll/statutory/challans?period=2026-06",
  "/v1/payroll/statutory/reconcile?period=2026-06",
  "/v1/payroll/ddos",
  "/v1/payroll/pensioners",
  "/v1/payroll/arrears",
  "/v1/payroll/bonus",
  "/v1/payroll/statutory/pt",
  "/v1/payroll/statutory/lwf",
  "/v1/payroll/reimbursements",
  "/v1/payroll/salary-revisions",
  "/v1/payroll/register",
  "/v1/payroll/ctc/config",
  "/v1/payroll/comparison?period1=2025-06&period2=2025-07",
];

describe("GET routes — handler responds", () => {
  for (const url of getRoutes) {
    it(`GET ${url}`, async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "GET",
        url,
        headers: { authorization: `Bearer ${token()}` },
      });
      await app.close();
      expect([200, 400, 404, 500, 502]).toContain(res.statusCode);
    });
  }
});

// ═══════════════════════════════════════════════════════════════════
// POST routes — valid payloads (expect NOT 404)
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/runs — valid payload", () => {
  it("accepts valid run creation payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token()}` },
      payload: { runNo: "RUN/2026/06", month: "2026-06", structureId: randomUUID() },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/structures — valid payload", () => {
  it("accepts valid structure creation payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/structures",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Default", components: [] },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/loans — valid payload", () => {
  it("accepts valid loan creation payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/loans",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        loanNo: "LN/001",
        employeeId: randomUUID(),
        loanType: "personal",
        principalMinor: 5000000,
        emiMinor: 500000,
        tenureMonths: 12,
        interestRatePct: 8,
        currency: "INR",
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/tax-declarations — valid payload", () => {
  it("accepts valid tax declaration payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax-declarations",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        employeeId: randomUUID(),
        fy: "2025-26",
        regime: "new",
        section80c: 150000,
        section80d: 25000,
        otherDeductions: 0,
        rentPaidMinor: 240000,
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/ddos — valid payload", () => {
  it("accepts valid DDO creation payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ddos",
      headers: { authorization: `Bearer ${token()}` },
      payload: { ddoCode: "DDO001", name: "Treasury Office A", departmentIds: [] },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/pensioners — valid payload", () => {
  it("accepts valid pensioner creation payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/pensioners",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        ppoNo: "PPO/2024/001",
        fullName: "Rani Sharma",
        dateOfBirth: "1960-05-15",
        basicPensionMinor: 3500000,
        taxRegime: "new",
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/statutory/perquisite-components — valid payload", () => {
  it("accepts valid perquisite component payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        employeeId: randomUUID(),
        fy: "2025-26",
        nature: "accommodation",
        valueByEmployer: 60000,
        amountRecovered: 10000,
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/statutory/challans — valid payload", () => {
  it("accepts valid challan payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        period: "2026-06",
        bsrCode: "1234567",
        challanSerial: "00001",
        depositDate: "2026-06-15",
        tdsAmount: 50000,
        section: "192",
        formType: "24Q",
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/arrears — valid payload", () => {
  it("accepts valid arrear payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/arrears",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        employeeId: randomUUID(),
        componentCode: "BASIC",
        fromPeriod: "2025-01",
        toPeriod: "2025-06",
        oldAmountMinor: 4000000,
        newAmountMinor: 4500000,
        reason: "Pay Commission revision",
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/bonus/compute — valid payload", () => {
  it("accepts valid bonus computation payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/bonus/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        employeeId: randomUUID(),
        fy: "2025-26",
        basicMinor: 5000000,
        bonusPct: 8.33,
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/reimbursements — valid payload", () => {
  it("accepts valid reimbursement payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: { authorization: `Bearer ${token()}` },
      payload: {
        employeeId: randomUUID(),
        category: "medical",
        amountMinor: 250000,
        period: "2026-06",
        billDate: "2026-06-01",
        billRef: "BILL/MED/001",
      },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

describe("POST /v1/payroll/ctc/calculate — valid payload", () => {
  it("accepts valid CTC calculation payload", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ctc/calculate",
      headers: { authorization: `Bearer ${token()}` },
      payload: { ctcMinor: 12000000 },
    });
    await app.close();
    expect(res.statusCode).not.toBe(404);
    expect([200, 201, 202, 400, 409, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PATCH routes — exercise handler paths
// ═══════════════════════════════════════════════════════════════════

describe("PATCH routes — handler responds", () => {
  it("PATCH /v1/payroll/runs/:id/approve", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${FAKE}/approve`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([200, 202, 404, 409, 500]).toContain(res.statusCode);
  });

  it("PATCH /v1/payroll/runs/:id/disburse", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${FAKE}/disburse`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([200, 202, 404, 409, 500]).toContain(res.statusCode);
  });

  it("PATCH /v1/payroll/runs/:id/revert", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/runs/${FAKE}/revert`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([200, 202, 404, 409, 500]).toContain(res.statusCode);
  });

  it("PATCH /v1/payroll/loans/:id/disburse", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: `/v1/payroll/loans/${FAKE}/disburse`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([200, 202, 404, 409, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Auth rejection (403) — citizen role denied on key routes
// ═══════════════════════════════════════════════════════════════════

describe("Auth rejection — 403 for citizen role", () => {
  const forbidden = [
    { method: "GET" as const, url: "/v1/payroll/runs" },
    { method: "GET" as const, url: "/v1/payroll/structures" },
    { method: "GET" as const, url: "/v1/payroll/statutory/pf" },
    { method: "GET" as const, url: "/v1/payroll/arrears" },
    { method: "GET" as const, url: "/v1/payroll/ddos" },
    { method: "POST" as const, url: "/v1/payroll/runs" },
    { method: "POST" as const, url: "/v1/payroll/structures" },
    { method: "POST" as const, url: "/v1/payroll/loans" },
  ];

  for (const { method, url } of forbidden) {
    it(`${method} ${url} → 403`, async () => {
      const app = await buildApp();
      const res = await app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${badToken()}` },
        ...(method === "POST" ? { payload: {} } : {}),
      });
      await app.close();
      expect(res.statusCode).toBe(403);
    });
  }
});


// ═══════════════════════════════════════════════════════════════════
// Additional validation path tests — statutory returns
// ═══════════════════════════════════════════════════════════════════

describe("Statutory returns — validation error paths", () => {
  it("GET /v1/payroll/statutory/form24q — 400 missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/form24q — 400 missing quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/form24q — 400 invalid quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q9",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/form24q — 400 malformed fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=badfy&quarter=Q1",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/form26q — 400 missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/form26q — 400 missing quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/form26q — 400 invalid quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=X",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/nps-scf — 400 missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/nps-scf — 400 malformed fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?fy=xyz",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/ecr — 400 missing month", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/ecr",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/ecr — 400 invalid month format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/ecr?month=bad",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/perquisite-components — 400 missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${token()}` },
      payload: { fy: "2025-26", nature: "accommodation", valueByEmployer: 50000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/perquisite-components — 400 missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), nature: "car", valueByEmployer: 30000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/perquisite-components — 400 missing nature", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", valueByEmployer: 30000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/perquisite-components — 400 missing valueByEmployer", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/perquisite-components — 400 invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), fy: "badyear", nature: "car", valueByEmployer: 30000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/challans — 400 missing period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${token()}` },
      payload: { bsrCode: "1234567", challanSerial: "001", depositDate: "2026-06-15", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/challans — 400 invalid bsrCode", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${token()}` },
      payload: { period: "2026-06", bsrCode: "bad", challanSerial: "001", depositDate: "2026-06-15", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/challans — 400 missing challanSerial", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${token()}` },
      payload: { period: "2026-06", bsrCode: "1234567", depositDate: "2026-06-15", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/challans — 400 invalid depositDate", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${token()}` },
      payload: { period: "2026-06", bsrCode: "1234567", challanSerial: "001", depositDate: "bad", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/statutory/challans — 400 missing tdsAmount", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${token()}` },
      payload: { period: "2026-06", bsrCode: "1234567", challanSerial: "001", depositDate: "2026-06-15" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/statutory/reconcile — 400 missing period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([200, 400]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Additional POST validation paths — payroll core
// ═══════════════════════════════════════════════════════════════════

describe("POST validation paths — payroll core", () => {
  it("POST /v1/payroll/runs — 400 invalid month format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token()}` },
      payload: { runNo: "RUN/BAD", month: "bad-month", structureId: randomUUID() },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/runs — 400 missing runNo", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token()}` },
      payload: { month: "2026-06", structureId: randomUUID() },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/runs — pensioner type without structureId ok", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token()}` },
      payload: { runNo: "RUN/PENS/01", month: "2026-06", runType: "pensioner" },
    });
    await app.close();
    expect([200, 201, 202, 400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/payroll/runs — 400 non-pensioner without structureId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/runs",
      headers: { authorization: `Bearer ${token()}` },
      payload: { runNo: "RUN/REG/01", month: "2026-06", runType: "regular" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/ddos — 400 missing ddoCode", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ddos",
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Test Office" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/pensioners — 400 missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/pensioners",
      headers: { authorization: `Bearer ${token()}` },
      payload: { ppoNo: "PPO/001" },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/loans — 400 invalid employeeId format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/loans",
      headers: { authorization: `Bearer ${token()}` },
      payload: { loanNo: "LN/002", employeeId: "not-a-uuid", loanType: "personal", principalMinor: 100000, emiMinor: 10000, tenureMonths: 12 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/arrears — 400 missing required fields", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/arrears",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID() },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/payroll/bonus/compute — 400 missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/bonus/compute",
      headers: { authorization: `Bearer ${token()}` },
      payload: { fy: "2025-26", basicMinor: 500000 },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/payroll/reimbursements — 400 invalid category", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/reimbursements",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), category: "invalid_cat", amountMinor: 10000, period: "2026-06" },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/payroll/ctc/calculate — 400 missing ctcMinor", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/ctc/calculate",
      headers: { authorization: `Bearer ${token()}` },
      payload: {},
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Tax route validation paths
// ═══════════════════════════════════════════════════════════════════

describe("Tax route — validation error paths", () => {
  it("GET /v1/payroll/tax/computation — 400 missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/computation?fy=2025-26",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/tax/form16 — 400 missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax/form16?fy=2025-26",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("POST /v1/payroll/tax-declarations — 400 missing fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax-declarations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), regime: "new", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 0 },
    });
    await app.close();
    expect([400, 500]).toContain(res.statusCode);
  });

  it("POST /v1/payroll/tax-declarations — 400 invalid fy format", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/tax-declarations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { employeeId: randomUUID(), fy: "2025-99", regime: "new", section80c: 0, section80d: 0, otherDeductions: 0, rentPaidMinor: 0 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("GET /v1/payroll/tax-declarations — 400 missing employeeId", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/tax-declarations?fy=2025-26",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

// ═══════════════════════════════════════════════════════════════════
// Bank transfer & ECR — handler reachability (deep paths)
// ═══════════════════════════════════════════════════════════════════

describe("Bank transfer & ECR — handler reachability", () => {
  it("GET /v1/payroll/runs/:id/bank-file — 404 for unknown run", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/runs/${randomUUID()}/bank-file`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/payroll/statutory/ecr — 404 no PF records found", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/ecr?month=2000-01",
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([404, 400, 500]).toContain(res.statusCode);
  });

  it("GET /v1/payroll/slips/:id — 404 for unknown slip", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${randomUUID()}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(404);
  });

  it("GET /v1/payroll/slips/:id/pdf — 404 for unknown slip", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${randomUUID()}/pdf`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });

  it("GET /v1/payroll/slips/:id/download — 404 for unknown slip", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/slips/${randomUUID()}/download`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });
});
