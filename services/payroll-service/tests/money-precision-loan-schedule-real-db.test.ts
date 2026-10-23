/**
 * Money precision: GET /v1/payroll/loans/:id/schedule used to run the whole
 * amortisation on JS floats (Number(principalMinor), Math.round(balance*rate)).
 * It is now bigint paise with exact round-half-up interest, converting to JSON
 * numbers only at the response edge through the range-checked converter.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { signToken } from "@civitasone/auth";
import { db, sqlClient } from "../src/shared/db.js";
import { buildApp } from "../src/app.js";
import { payrollLoans } from "../src/modules/loans/schema.js";
import { divRoundHalfUp } from "../src/shared/money.js";

const SECRET = process.env.JWT_SECRET as string;
const TENANT = randomUUID();
const ACTOR = randomUUID();
const EMP = randomUUID();
const LOAN = randomUUID();
const HUGE_LOAN = randomUUID();

const PRINCIPAL = 1_234_567_89n; // 12,34,567.89 rupees
const EMI = 5_432_10n;
const RATE_HUNDREDTHS = 875n; // 8.75 %

const token = () => signToken({ sub: ACTOR, tid: TENANT, roles: ["payroll_admin"], sid: "money-precision" }, SECRET);

beforeAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(payrollLoans).values({
      id: LOAN, tenantId: TENANT, loanNo: "MP-LOAN-1", employeeId: EMP, loanType: "personal",
      principalMinor: PRINCIPAL, outstandingMinor: PRINCIPAL, emiMinor: EMI, tenureMonths: 36,
      interestRatePct: "8.75", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(payrollLoans).values({
      id: HUGE_LOAN, tenantId: TENANT, loanNo: "MP-LOAN-2", employeeId: EMP, loanType: "personal",
      principalMinor: BigInt(Number.MAX_SAFE_INTEGER) + 2n, outstandingMinor: BigInt(Number.MAX_SAFE_INTEGER) + 2n,
      emiMinor: EMI, tenureMonths: 12, interestRatePct: "8.75", status: "disbursed", createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(payrollLoans).where(eq(payrollLoans.tenantId, TENANT));
  }));
  await sqlClient.end();
});

type Row = { installmentNo: number; openingMinor: number; emiMinor: number; principalMinor: number; interestMinor: number; closingMinor: number };

describe("loan repayment schedule money is exact bigint paise", () => {
  it("matches an independent bigint amortisation and ships JSON NUMBERS (no strings, no bigint)", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/loans/${LOAN}/schedule`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.statusCode).toBe(200);
    const body = res.json() as { principalMinor: number; emiMinor: number; interestRatePct: number; schedule: Row[] };

    expect(typeof body.principalMinor).toBe("number");
    expect(body.principalMinor).toBe(Number(PRINCIPAL));
    expect(body.emiMinor).toBe(Number(EMI));
    expect(body.interestRatePct).toBe(8.75);

    // Reference: round-half-up(balance * 8.75% / 12) on bigint, same clamping rules.
    let balance = PRINCIPAL;
    const expected: Row[] = [];
    for (let i = 1; i <= 36; i++) {
      const interest = divRoundHalfUp(balance * RATE_HUNDREDTHS, 100n * 1200n);
      const principalPart = EMI - interest < 0n ? 0n : (EMI - interest > balance ? balance : EMI - interest);
      const closing = balance - principalPart < 0n ? 0n : balance - principalPart;
      expected.push({
        installmentNo: i, openingMinor: Number(balance), emiMinor: Number(EMI),
        principalMinor: Number(principalPart), interestMinor: Number(interest), closingMinor: Number(closing),
      });
      balance = closing;
      if (balance === 0n) break;
    }
    expect(body.schedule).toEqual(expected);
    for (const r of body.schedule) {
      for (const v of [r.openingMinor, r.emiMinor, r.principalMinor, r.interestMinor, r.closingMinor]) {
        expect(Number.isSafeInteger(v)).toBe(true);
      }
      expect(r.openingMinor - r.principalMinor).toBe(r.closingMinor);
    }
  });

  it("refuses (500) to answer a principal beyond 2^53 paise rather than returning a silently rounded figure", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: `/v1/payroll/loans/${HUGE_LOAN}/schedule`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("9007199254740992");
    expect(res.body).not.toContain("9007199254740993");
  });
});
