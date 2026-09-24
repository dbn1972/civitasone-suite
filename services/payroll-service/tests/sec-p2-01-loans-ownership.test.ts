/**
 * SEC-P2-01 regression: GET /v1/payroll/loans (?empId=), GET
 * /v1/payroll/loans/:id and GET /v1/payroll/loans/:id/schedule previously had
 * NO ownership check — any authenticated `employee`-role caller could pass
 * (or discover, by iterating) another employee's UUID / loan id and read
 * their co-worker's loan principal, EMI, interest rate and full repayment
 * schedule (IDOR). All three routes now call enforceEmployeeOwnership(...),
 * the same guard already used by payslip-pdf/routes.ts (SEC-P1-01) and
 * tax/routes.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { payrollLoans } from "../src/modules/loans/schema.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const ADMIN_ACTOR = randomUUID();
const EMP_OWN = randomUUID();
const EMP_OTHER = randomUUID();
const LOAN_OWN = randomUUID();
const LOAN_OTHER = randomUUID();

function token(sub: string, roles: string[]) {
  return signToken({ sub, tid: TENANT, roles, sid: "sec-p2-01" }, SECRET);
}

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollLoans).values({
      id: LOAN_OWN, tenantId: TENANT, loanNo: "SEC-P2-01-OWN", employeeId: EMP_OWN,
      loanType: "personal", principalMinor: 1_200_000n, outstandingMinor: 1_200_000n,
      emiMinor: 50_000n, tenureMonths: 24, interestRatePct: "12.00",
      status: "disbursed", createdBy: ADMIN_ACTOR, updatedBy: ADMIN_ACTOR,
    });
    await tx.insert(payrollLoans).values({
      id: LOAN_OTHER, tenantId: TENANT, loanNo: "SEC-P2-01-OTHER", employeeId: EMP_OTHER,
      loanType: "personal", principalMinor: 900_000n, outstandingMinor: 900_000n,
      emiMinor: 40_000n, tenureMonths: 24, interestRatePct: "10.00",
      status: "disbursed", createdBy: ADMIN_ACTOR, updatedBy: ADMIN_ACTOR,
    });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollLoans).where(eq(payrollLoans.tenantId, TENANT));
  }));
  await sqlClient.end();
});

describe("GET /v1/payroll/loans?empId= — ownership (SEC-P2-01)", () => {
  it("rejects a self-service employee listing a co-worker's loans (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("lets a self-service employee list their OWN loans (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans?empId=${EMP_OWN}`,
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data.some((l: { id: string }) => l.id === LOAN_OWN)).toBe(true);
    expect(data.every((l: { employeeId: string }) => l.employeeId === EMP_OWN)).toBe(true);
  });

  it("lets a payroll_admin list another employee's loans unchanged (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans?empId=${EMP_OTHER}`,
      headers: { authorization: `Bearer ${token(ADMIN_ACTOR, ["payroll_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const data = res.json();
    expect(data.some((l: { id: string }) => l.id === LOAN_OTHER)).toBe(true);
  });
});

describe("GET /v1/payroll/loans/:id — ownership (SEC-P2-01)", () => {
  it("rejects a self-service employee viewing a co-worker's loan by id (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans/${LOAN_OTHER}`,
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("lets a self-service employee view their OWN loan by id (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans/${LOAN_OWN}`,
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(LOAN_OWN);
  });

  it("lets a payroll_admin view another employee's loan by id unchanged (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans/${LOAN_OTHER}`,
      headers: { authorization: `Bearer ${token(ADMIN_ACTOR, ["payroll_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(LOAN_OTHER);
  });
});

describe("GET /v1/payroll/loans/:id/schedule — ownership (SEC-P2-01)", () => {
  it("rejects a self-service employee viewing a co-worker's repayment schedule (403)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans/${LOAN_OTHER}/schedule`,
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(403);
  });

  it("lets a self-service employee view their OWN repayment schedule (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans/${LOAN_OWN}/schedule`,
      headers: { authorization: `Bearer ${token(EMP_OWN, ["employee"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.loanId).toBe(LOAN_OWN);
    expect(Array.isArray(body.schedule)).toBe(true);
  });

  it("lets a payroll_admin view another employee's repayment schedule unchanged (200)", async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: "GET",
      url: `/v1/payroll/loans/${LOAN_OTHER}/schedule`,
      headers: { authorization: `Bearer ${token(ADMIN_ACTOR, ["payroll_admin"])}` },
    });
    await app.close();
    expect(res.statusCode).toBe(200);
    expect(res.json().loanId).toBe(LOAN_OTHER);
  });
});
