/**
 * CPF contributory provident fund account (SVC-018) — route + persistence proof.
 * Proves: open gated on CPF scheme, subscription credits both employee+employer
 * legs (idempotent per period), advance/withdrawal debit guard, refund + interest
 * accrual, and a running-balance statement round-trip through the DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsCpfLedger } from "../src/modules/cpf/schema.js";

const TENANT = randomUUID();
const ACTOR = randomUUID();

function mint(roles: string[], tid = TENANT): string {
  const S = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
  const n = Math.floor(Date.now() / 1000);
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b({ alg: "HS256", typ: "JWT" });
  const p = b({ sub: ACTOR, iss: "civitasone-dev", tid, tenantId: tid, sid: "t", email: "t@t.dev", name: "T", roles, iat: n, exp: n + 3600 });
  const s = createHmac("sha256", S).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}
const HR = { authorization: `Bearer ${mint(["hr_admin", "super_admin"])}`, "content-type": "application/json" };

let app: FastifyInstance;
const deptId = randomUUID();
const desigId = randomUUID();
const empCpf = randomUUID();
const empCpf2 = randomUUID();
const empNps = randomUUID();

async function seedEmployee(id: string, scheme: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: "Test Emp",
      departmentId: deptId, designationId: desigId, dateOfJoining: "1998-06-01",
      status: "confirmed", basicMinor: 5610000n, employeeType: "permanent",
      pensionScheme: scheme, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "D1", name: "Dept 1", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "JR", name: "Junior", level: 10, createdBy: ACTOR, updatedBy: ACTOR });
  }));
  await seedEmployee(empCpf, "CPF");
  await seedEmployee(empCpf2, "CPF");
  await seedEmployee(empNps, "NPS");
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsCpfLedger).where(eq(hrmsCpfLedger.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("CPF contributory provident fund", () => {
  it("rejects opening a CPF account for a non-CPF (NPS) employee", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/cpf`, headers: HR,
      payload: { cpfNumber: "CPF-X" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_CPF_SCHEME");
  });

  it("opens a CPF account with an opening balance", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR,
      payload: { cpfNumber: "CPF-1001", openingEmpMinor: 200000, openingErMinor: 200000, interestRatePct: 7.1 } });
    expect(res.statusCode).toBe(201);
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    expect(get.json().runningBalanceMinor).toBe("400000");
  });

  it("rejects a second CPF account with a cpf_number already taken in the tenant (409, not 500)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf2}/cpf`, headers: HR,
      payload: { cpfNumber: "CPF-1001" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CPF_NUMBER_TAKEN");
  });

  it("rejects a duplicate CPF account for the same employee with 409, not 500", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR,
      payload: { cpfNumber: "CPF-9999" } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CPF_EXISTS");
  });

  it("posts monthly subscription crediting both legs, idempotent per period", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/subscription`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 56100 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("512200");
    expect(res.json().employeeBalanceMinor).toBe("256100");

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/subscription`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 56100 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PERIOD_ALREADY_POSTED");
  });

  it("takes an advance (debit, employer leg first) and refunds it", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/advance`, headers: HR,
      payload: { amountMinor: 100000, narrative: "house advance" } });
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("412200");

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/refund`, headers: HR,
      payload: { amountMinor: 40000 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("452200");
  });

  it("guards a withdrawal against overdraft", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/withdrawal`, headers: HR,
      payload: { amountMinor: 999999999 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INSUFFICIENT_BALANCE");
  });

  it("accrues interest on the total corpus", async () => {
    const before = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    const prevBal = BigInt(before.json().runningBalanceMinor);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/interest`, headers: HR,
      payload: { months: 12, ratePctOverride: 10 } });
    expect(res.statusCode).toBe(201);
    // 10% for 12 months on 452200 = 45220
    expect(res.json().interestMinor).toBe("45220");
    expect(BigInt(res.json().balanceMinor)).toBe(prevBal + 45220n);
  });

  it("statement lists every ledger entry in order", async () => {
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    const types = get.json().ledger.map((l: { entryType: string }) => l.entryType);
    expect(types).toEqual(["opening", "subscription", "advance", "refund", "interest"]);
  });
});
