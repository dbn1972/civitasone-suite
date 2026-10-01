/**
 * GAP-PAYROLL-LOANS-02 (maker-checker on loan disbursal) and
 * GAP-PAYROLL-LOANS-05 (duplicate loan number) -- route-level regression.
 *
 * PATCH /v1/payroll/loans/:id/disburse used to publish the disburse command
 * for ANY id, in ANY status, by ANY payroll officer -- including the officer
 * who created the loan. It now pre-checks (404 / 403 / 409) and audits a
 * blocked self-disbursal; consumer.ts re-checks the same rule under a row
 * lock (see tests/loans-tax-consumer.test.ts).
 */
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { payrollLoans } from "../src/modules/loans/schema.js";
import { COMMANDS } from "../src/topics.js";
import { deterministicUuid } from "../src/shared/deterministic-id.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const OTHER_TENANT = randomUUID();
const MAKER = randomUUID();
const CHECKER = randomUUID();
const EMP = randomUUID();
const LOAN_APPLIED = randomUUID();
const LOAN_CLOSED = randomUUID();
const LOAN_OTHER_TENANT = randomUUID();
const LOAN_NO_TAKEN = `GAP-LOANS-05-${TENANT.slice(0, 8)}`;

function token(sub: string, tid = TENANT) {
  return signToken({ sub, tid, roles: ["payroll_officer"], sid: "gap-loans-02" }, SECRET);
}

function loanRow(id: string, tenantId: string, status: string, loanNo: string) {
  return {
    id, tenantId, loanNo, employeeId: EMP, loanType: "personal",
    principalMinor: 1_000_000n, outstandingMinor: 1_000_000n, emiMinor: 100_000n,
    tenureMonths: 10, interestRatePct: "0", status, createdBy: MAKER, updatedBy: MAKER,
  };
}

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollLoans).values(loanRow(LOAN_APPLIED, TENANT, "applied", LOAN_NO_TAKEN));
    await tx.insert(payrollLoans).values(loanRow(LOAN_CLOSED, TENANT, "closed", `${LOAN_NO_TAKEN}-C`));
  }));
  await runWithTenant(OTHER_TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollLoans).values(loanRow(LOAN_OTHER_TENANT, OTHER_TENANT, "applied", `${LOAN_NO_TAKEN}-X`));
  }));
});

afterEach(() => { vi.restoreAllMocks(); });

afterAll(async () => {
  for (const t of [TENANT, OTHER_TENANT]) {
    await runWithTenant(t, () => db.transaction(async (tx) => {
      await tx.delete(payrollLoans).where(eq(payrollLoans.tenantId, t));
    }));
  }
  await sqlClient.end();
});

async function disburse(loanId: string, sub: string, body?: unknown) {
  const app = await buildApp();
  const res = await app.inject({
    method: "PATCH",
    url: `/v1/payroll/loans/${loanId}/disburse`,
    headers: { authorization: `Bearer ${token(sub)}` },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  await app.close();
  return res;
}

describe("PATCH /v1/payroll/loans/:id/disburse (GAP-PAYROLL-LOANS-02)", () => {
  it("403s the officer who created the loan and publishes a denied audit event", async () => {
    const publishSpy = vi.spyOn(queue, "publish");
    const res = await disburse(LOAN_APPLIED, MAKER, { reason: "self" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("SELF_DISBURSE_FORBIDDEN");
    const topics = publishSpy.mock.calls.map((c) => c[0]);
    expect(topics).not.toContain(COMMANDS.loanDisburse);
    const auditCall = publishSpy.mock.calls.find((c) => c[0] === "audit.event.record");
    expect(auditCall).toBeDefined();
    expect((auditCall![1] as { payload: Record<string, unknown> }).payload).toMatchObject({
      service: "payroll", action: "disburse", resourceType: "loan", resourceId: LOAN_APPLIED,
      outcome: "denied", denialCode: "SELF_DISBURSE_FORBIDDEN",
    });
  });

  it("accepts a different officer and forwards employeeId + reason on the command", async () => {
    const publishSpy = vi.spyOn(queue, "publish");
    const res = await disburse(LOAN_APPLIED, CHECKER, { reason: "Sanction order 42" });
    expect(res.statusCode).toBe(202);
    const cmd = publishSpy.mock.calls.find((c) => c[0] === COMMANDS.loanDisburse);
    expect(cmd).toBeDefined();
    expect((cmd![1] as { payload: Record<string, unknown> }).payload).toMatchObject({
      id: LOAN_APPLIED, tenantId: TENANT, employeeId: EMP, reason: "Sanction order 42",
    });
  });

  it("still accepts a body-less request from a different officer (back-compat)", async () => {
    const res = await disburse(LOAN_APPLIED, CHECKER);
    expect(res.statusCode).toBe(202);
  });

  it("409s a loan that is not in 'applied'", async () => {
    const res = await disburse(LOAN_CLOSED, CHECKER);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LOAN_NOT_DISBURSABLE");
  });

  it("404s an unknown loan id and another tenant's loan id", async () => {
    expect((await disburse(randomUUID(), CHECKER)).statusCode).toBe(404);
    expect((await disburse(LOAN_OTHER_TENANT, CHECKER)).statusCode).toBe(404);
  });

  it("400s an unknown body field or an over-long reason", async () => {
    expect((await disburse(LOAN_APPLIED, CHECKER, { reason: "x".repeat(501) })).statusCode).toBe(400);
    expect((await disburse(LOAN_APPLIED, CHECKER, { amountMinor: 1 })).statusCode).toBe(400);
  });
});

describe("POST /v1/payroll/loans duplicate loan number (GAP-PAYROLL-LOANS-05)", () => {
  async function create(loanNo: string) {
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/loans",
      headers: { authorization: `Bearer ${token(MAKER)}` },
      payload: {
        loanNo, employeeId: randomUUID(), loanType: "personal",
        principalMinor: 100_000, emiMinor: 10_000, tenureMonths: 10, interestRatePct: 0, currency: "INR",
      },
    });
    await app.close();
    return res;
  }

  it("409s a loan number already used in the tenant", async () => {
    const res = await create(LOAN_NO_TAKEN);
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("LOAN_NO_TAKEN");
  });

  it("maps a retried submit with the same x-idempotency-key to the same loan id", async () => {
    const key = randomUUID();
    const send = async () => {
      const app = await buildApp();
      const res = await app.inject({
        method: "POST",
        url: "/v1/payroll/loans",
        headers: { authorization: `Bearer ${token(MAKER)}`, "x-idempotency-key": key },
        payload: {
          loanNo: `${LOAN_NO_TAKEN}-IDEM-${key.slice(0, 6)}`, employeeId: EMP, loanType: "personal",
          principalMinor: 100_000, emiMinor: 10_000, tenureMonths: 10, interestRatePct: 0, currency: "INR",
        },
      });
      await app.close();
      return res;
    };
    const first = await send();
    const second = await send();
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(202);
    expect(second.json().id).toBe(first.json().id);
  });

  it("answers 202 (not 409) when the idempotent retry's loan already landed", async () => {
    const key = randomUUID();
    const landedId = deterministicUuid(`payroll-loan-create:${TENANT}:${key}`);
    const loanNo = `${LOAN_NO_TAKEN}-LANDED-${key.slice(0, 6)}`;
    await runWithTenant(TENANT, () => db.transaction(async (tx) => {
      await tx.insert(payrollLoans).values(loanRow(landedId, TENANT, "applied", loanNo));
    }));
    const app = await buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/v1/payroll/loans",
      headers: { authorization: `Bearer ${token(MAKER)}`, "x-idempotency-key": key },
      payload: {
        loanNo, employeeId: EMP, loanType: "personal",
        principalMinor: 100_000, emiMinor: 10_000, tenureMonths: 10, interestRatePct: 0, currency: "INR",
      },
    });
    await app.close();
    expect(res.statusCode).toBe(202);
    expect(res.json().id).toBe(landedId);
  });

  it("accepts a fresh loan number", async () => {
    const res = await create(`${LOAN_NO_TAKEN}-NEW-${randomUUID().slice(0, 6)}`);
    expect(res.statusCode).toBe(202);
  });
});
