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
import { queue } from "../src/shared/infra.js";
import { registerF3_cpf_Consumers } from "../src/modules/cpf/f3-consumer.js";

// These routes only PUBLISH; the rows are written by the F3 consumer that
// worker.ts runs. Register it here the same way worker.ts does — wrapping
// subscribe in runWithTenant so the consumer's db.transaction() carries the
// app.tenant_id GUC that RLS requires. Without this the suite exercised the
// HTTP layer only and could not see that the consumer never wrote anything.
registerF3_cpf_Consumers({
  subscribe: (topic: string, handler: (msg: { tenantId: string }) => Promise<void>) =>
    queue.subscribe(topic, (msg) => runWithTenant((msg as { tenantId: string }).tenantId, () => handler(msg as { tenantId: string }))),
} as unknown as typeof queue);

/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

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
const empCpf3 = randomUUID();

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
  await seedEmployee(empCpf3, "CPF");
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
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_CPF_SCHEME");
  });

  it("opens a CPF account with an opening balance", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR,
      payload: { cpfNumber: "CPF-1001", openingEmpMinor: 200000, openingErMinor: 200000, interestRatePct: 7.1 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    await drainF3();
    expect(get.json().runningBalanceMinor).toBe("400000");
  });

  it("rejects a second CPF account with a cpf_number already taken in the tenant (409, not 500)", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf2}/cpf`, headers: HR,
      payload: { cpfNumber: "CPF-1001" } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CPF_NUMBER_TAKEN");
  });

  it("rejects a duplicate CPF account for the same employee with 409, not 500", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR,
      payload: { cpfNumber: "CPF-9999" } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("CPF_EXISTS");
  });

  it("posts monthly subscription crediting both legs, idempotent per period", async () => {
    // publishF3Write is fire-and-forget CQRS: it can never know the resulting
    // balance (that's computed by the consumer under an advisory lock, to
    // serialize concurrent postings — see cpf/repo.ts's lockedBalance). The
    // route now answers 202 with only what it validated synchronously; the
    // persisted balance is asserted via GET below, same as the full-ledger
    // proof test further down.
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/subscription`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 56100 } });
    await drainF3();
    expect(res.statusCode).toBe(202);
    expect(res.json().period).toBe("2026-04");
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    await drainF3();
    expect(get.json().runningBalanceMinor).toBe("512200");
    expect(get.json().employeeBalanceMinor).toBe("256100");

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/subscription`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 56100 } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PERIOD_ALREADY_POSTED");
  });

  it("takes an advance (debit, employer leg first) and refunds it", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/advance`, headers: HR,
      payload: { amountMinor: 100000, narrative: "house advance" } });
    await drainF3();
    expect(res.statusCode).toBe(202);
    expect(res.json().amountMinor).toBe("100000");
    let get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    await drainF3();
    expect(get.json().runningBalanceMinor).toBe("412200");

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/refund`, headers: HR,
      payload: { amountMinor: 40000 } });
    await drainF3();
    expect(res.statusCode).toBe(202);
    get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    await drainF3();
    expect(get.json().runningBalanceMinor).toBe("452200");
  });

  it("guards a withdrawal against overdraft", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/withdrawal`, headers: HR,
      payload: { amountMinor: 999999999 } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INSUFFICIENT_BALANCE");
  });

  it("accrues interest on the total corpus", async () => {
    const before = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    await drainF3();
    const prevBal = BigInt(before.json().runningBalanceMinor);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empCpf}/cpf/interest`, headers: HR,
      payload: { months: 12, ratePctOverride: 10 } });
    await drainF3();
    expect(res.statusCode).toBe(202);
    expect(res.json().ratePct).toBe(10);
    const after = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    await drainF3();
    // 10% for 12 months on 452200 = 45220
    expect(BigInt(after.json().runningBalanceMinor)).toBe(prevBal + 45220n);
  });

  it("statement lists every ledger entry in order", async () => {
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empCpf}/cpf`, headers: HR });
    await drainF3();
    const types = get.json().ledger.map((l: { entryType: string }) => l.entryType);
    expect(types).toEqual(["opening", "subscription", "advance", "refund", "interest"]);
  });
  /**
   * End-to-end proof of the F3 CPF consumer over a real database, on its own
   * employee so it does not depend on the fixtures above.
   *
   * Before the consumer fix every one of these writes threw a ReferenceError
   * inside the async consumer (`acct`, `empAmt`, `ratePct`, `ledgerId` … were
   * never declared) while the HTTP layer reported success, so the ledger stayed
   * empty. Assertions are made on the PERSISTED statement rather than on the
   * POST responses: routes.ts answers 202 "accepted" for subscription/
   * debit/refund/interest and deliberately does not carry a balance in the
   * response (the running balance depends on every prior entry and is only
   * knowable inside the consumer's advisory-locked read — see the comments on
   * each route). The ledger below is what must be right; the routes' own
   * "202 + only what was validated" contract is asserted directly in
   * cpf-account.test.ts's earlier cases.
   */
  it("consumer writes the full CPF ledger with correct running balances", async () => {
    const url = `/v1/hrms/employees/${empCpf3}/cpf`;
    const statement = async () => {
      const g = await app.inject({ method: "GET", url, headers: HR });
      return g.json();
    };

    await app.inject({ method: "POST", url, headers: HR,
      payload: { cpfNumber: "CPF-3001", openingEmpMinor: 200000, openingErMinor: 200000, interestRatePct: 7.1 } });
    await drainF3();
    expect((await statement()).runningBalanceMinor).toBe("400000");

    // subscription credits BOTH legs
    await app.inject({ method: "POST", url: `${url}/subscription`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 56100 } });
    await drainF3();
    let st = await statement();
    expect(st.runningBalanceMinor).toBe("512200");
    expect(st.employeeBalanceMinor).toBe("256100");
    expect(st.employerBalanceMinor).toBe("256100");

    // re-posting the same period must not double-count (unique per period)
    await app.inject({ method: "POST", url: `${url}/subscription`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 56100 } });
    await drainF3();
    expect((await statement()).runningBalanceMinor).toBe("512200");

    // advance draws the EMPLOYER leg down first
    await app.inject({ method: "POST", url: `${url}/advance`, headers: HR,
      payload: { amountMinor: 100000, narrative: "house advance" } });
    await drainF3();
    st = await statement();
    expect(st.runningBalanceMinor).toBe("412200");
    expect(st.employerBalanceMinor).toBe("156100");
    expect(st.employeeBalanceMinor).toBe("256100");

    // a second advance must not collide on the ledger primary key
    await app.inject({ method: "POST", url: `${url}/advance`, headers: HR,
      payload: { amountMinor: 10000 } });
    await drainF3();
    expect((await statement()).runningBalanceMinor).toBe("402200");

    // refund credits the EMPLOYEE leg
    await app.inject({ method: "POST", url: `${url}/refund`, headers: HR, payload: { amountMinor: 40000 } });
    await drainF3();
    st = await statement();
    expect(st.runningBalanceMinor).toBe("442200");
    expect(st.employeeBalanceMinor).toBe("296100");

    // overdraft is refused by the consumer — the corpus must be untouched
    await app.inject({ method: "POST", url: `${url}/withdrawal`, headers: HR, payload: { amountMinor: 999999999 } });
    await drainF3();
    expect((await statement()).runningBalanceMinor).toBe("442200");

    // interest on the TOTAL corpus: 442200 * 10% * 12/12 = 44220
    await app.inject({ method: "POST", url: `${url}/interest`, headers: HR,
      payload: { months: 12, ratePctOverride: 10 } });
    await drainF3();
    st = await statement();
    expect(st.runningBalanceMinor).toBe("486420");
    expect(st.ledger.map((l: { entryType: string }) => l.entryType))
      .toEqual(["opening", "subscription", "advance", "advance", "refund", "interest"]);
  });
});
