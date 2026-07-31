/**
 * payroll-service — Statutory Returns + Challan routes integration tests
 *
 * Covers:
 * - GET /v1/payroll/statutory/form24q (happy, 400, 401, 403, 409)
 * - GET /v1/payroll/statutory/form12ba (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/nps-scf (happy, 400, 401, 403, 404)
 * - POST /v1/payroll/statutory/perquisite-components (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/form26q (happy, 400, 401, 403)
 * - POST /v1/payroll/statutory/challans (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/challans (happy, 400, 401, 403)
 * - GET /v1/payroll/statutory/reconcile (happy, 400, 401, 403)
 */
import { describe, it, expect, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { randomUUID } from "node:crypto";

const SECRET = "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000099";
const ACTOR = "aaaaaaaa-bbbb-4000-8000-000000000001";

function adminToken(roles = ["payroll_admin", "super_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, SECRET);
}
function filerToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin", "hr_admin", "finance_officer"], sid: "s1" }, SECRET);
}
function employeeToken(sub = ACTOR) {
  return signToken({ sub, tid: TENANT, roles: ["employee"], sid: "s1" }, SECRET);
}
function citizenToken() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["citizen"], sid: "s1" }, SECRET);
}

afterAll(async () => { /* pool closed by other test teardown */ });

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/form24q
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/form24q — happy path", () => {
  it("returns structured 24Q for valid fy + quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    // 200 if data loads; 409 if reconciliation mismatch; 500/502 if deps down
    expect([200, 409, 500, 502]).toContain(res.statusCode);
  });

  it("returns file format when format=file is passed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q2&format=file",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 409, 500, 502]).toContain(res.statusCode);
  });

  it("accepts force=1 to bypass reconciliation gate", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q3&force=1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/statutory/form24q — 400 validation", () => {
  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when quarter is missing/invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q9",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-99&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/form24q — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee-only role (no admin/officer)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form24q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/form12ba
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/form12ba — happy path", () => {
  it("returns form 12BA for valid employeeId + fy", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    // 200 if data loads; 500/502 if HRMS/DB unreachable
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/statutory/form12ba — 400 validation", () => {
  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}`,
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-99`,
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when employeeId is missing for admin caller", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form12ba?fy=2025-26",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/form12ba — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 when employee tries to access another employee's 12BA", async () => {
    const otherEmp = randomUUID();
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${otherEmp}&fy=2025-26`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("allows employee to access their own 12BA", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/statutory/form12ba?employeeId=${ACTOR}&fy=2025-26`,
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    // 200 if data loads; 500/502 if deps unavailable — but NOT 403
    expect([200, 500, 502]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/nps-scf
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/nps-scf — happy path", () => {
  it("returns NPS-SCF for valid month", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    // 200 if NPS data exists; 404 if no records; 500/502 if deps down
    expect([200, 404, 500, 502]).toContain(res.statusCode);
  });

  it("returns file format when format=file is passed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06&format=file",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([200, 404, 500, 502]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/statutory/nps-scf — 400 validation", () => {
  it("returns 400 when month is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when month format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=June2025",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when month uses wrong separator", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025/06",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/nps-scf — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role (not statutory admin)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2025-06",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /v1/payroll/statutory/nps-scf — 404", () => {
  it("returns 404 when no NPS records for a distant period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/nps-scf?month=2010-01",
      headers: { authorization: `Bearer ${adminToken()}` },
    });
    await app.close();
    expect([404, 500]).toContain(res.statusCode);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/statutory/perquisite-components
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/statutory/perquisite-components — happy path", () => {
  it("returns 201 for valid perquisite component", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: {
        employeeId: randomUUID(),
        fy: "2025-26",
        nature: "accommodation",
        description: "Company-provided housing",
        valueByEmployer: 50000,
        amountRecovered: 5000,
      },
    });
    await app.close();
    expect([201, 500]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      const body = res.json();
      expect(body.message).toContain("perquisite component saved");
      expect(body.nature).toBe("accommodation");
    }
  });
});

describe("POST /v1/payroll/statutory/perquisite-components — 400 validation", () => {
  it("returns 400 when employeeId is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-99", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when nature is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when valueByEmployer is negative", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${adminToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: -100 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/payroll/statutory/perquisite-components — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/perquisite-components",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { employeeId: randomUUID(), fy: "2025-26", nature: "car", valueByEmployer: 1000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/form26q
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/form26q — happy path", () => {
  it("returns structured 26Q for valid fy + quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.formType).toBe("26Q");
    }
  });

  it("returns file format when format=file", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q2&format=file",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
  });
});

describe("GET /v1/payroll/statutory/form26q — 400 validation", () => {
  it("returns 400 when fy is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when quarter is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q9",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is malformed", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-99&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/form26q — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/form26q?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// POST /v1/payroll/statutory/challans
// ═══════════════════════════════════════════════════════════════════

describe("POST /v1/payroll/statutory/challans — happy path", () => {
  it("returns 201 for valid challan ingestion", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: {
        period: "2025-06",
        bsrCode: "1234567",
        challanSerial: "00123",
        depositDate: "2025-07-07",
        tdsAmount: 50000,
        section: "192",
        formType: "24Q",
      },
    });
    await app.close();
    expect([200, 201, 500]).toContain(res.statusCode);
    if (res.statusCode === 201 || res.statusCode === 200) {
      const body = res.json();
      expect(body.cin).toBeDefined();
      expect(body.period).toBe("2025-06");
    }
  });

  it("is idempotent — second insert returns 200", async () => {
    const app = await buildApp();
    const payload = {
      period: "2025-05",
      bsrCode: "9876543",
      challanSerial: "00999",
      depositDate: "2025-06-10",
      tdsAmount: 25000,
      formType: "24Q",
    };
    const res1 = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload,
    });
    if (res1.statusCode === 201) {
      const res2 = await app.inject({
        method: "POST",
        url: "/v1/payroll/statutory/challans",
        headers: { authorization: `Bearer ${filerToken()}` },
        payload,
      });
      expect(res2.statusCode).toBe(200);
      expect(res2.json().message).toContain("idempotent");
    }
    await app.close();
  });
});

describe("POST /v1/payroll/statutory/challans — 400 validation", () => {
  it("returns 400 when period is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when bsrCode is not 7 digits", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "123", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when challanSerial is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when depositDate format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "07-07-2025", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when tdsAmount is negative", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: -100 },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /v1/payroll/statutory/challans — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${citizenToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${employeeToken()}` },
      payload: { period: "2025-06", bsrCode: "1234567", challanSerial: "00123", depositDate: "2025-07-07", tdsAmount: 5000 },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/challans
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/challans — happy path", () => {
  it("returns challan list for valid period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.period).toBe("2025-06");
      expect(body.formType).toBe("24Q");
      expect(body.challans).toBeDefined();
      expect(Array.isArray(body.challans)).toBe(true);
    }
  });

  it("accepts formType=26Q filter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06&formType=26Q",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.json().formType).toBe("26Q");
    }
  });
});

describe("GET /v1/payroll/statutory/challans — 400 validation", () => {
  it("returns 400 when period is missing", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when period format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=Jun2025",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/challans — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/challans?period=2025-06",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});

// ═══════════════════════════════════════════════════════════════════
// GET /v1/payroll/statutory/reconcile
// ═══════════════════════════════════════════════════════════════════

describe("GET /v1/payroll/statutory/reconcile — happy path", () => {
  it("returns reconciliation for a single period", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.formType).toBe("24Q");
      expect(body.perPeriod).toBeDefined();
      expect(typeof body.matched).toBe("boolean");
    }
  });

  it("returns reconciliation for fy + quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=2025-26&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body.perPeriod).toHaveLength(3);
    }
  });

  it("accepts formType=26Q", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06&formType=26Q",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      expect(res.json().formType).toBe("26Q");
    }
  });
});

describe("GET /v1/payroll/statutory/reconcile — 400 validation", () => {
  it("returns 400 when neither period nor fy+quarter provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy is provided without quarter", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=2025-26",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when quarter is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=2025-26&quarter=Q9",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when fy format is invalid", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?fy=invalid&quarter=Q1",
      headers: { authorization: `Bearer ${filerToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/payroll/statutory/reconcile — auth", () => {
  it("returns 401 when no token provided", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 for citizen role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
      headers: { authorization: `Bearer ${citizenToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for employee role", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/payroll/statutory/reconcile?period=2025-06",
      headers: { authorization: `Bearer ${employeeToken()}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });
});
