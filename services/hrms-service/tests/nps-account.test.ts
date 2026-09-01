/**
 * NPS individual PRAN account (SVC-018) — full-stack route + persistence proof.
 * Proves: enrolment gated on NPS scheme, a real running employee+employer
 * contribution ledger, idempotent per-period posting, withdrawal debit guard,
 * and a running-balance statement round-trip through the DB.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID, createHmac } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { buildApp } from "../src/app.js";
import { db, sqlClient } from "../src/shared/db.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsNpsContributions } from "../src/modules/nps/schema.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_nps_Consumers } from "../src/modules/nps/f3-consumer.js";

// These routes only PUBLISH; the rows are written by the F3 consumer that
// worker.ts runs. Register it here the same way worker.ts does — wrapping
// subscribe in runWithTenant so the consumer's db.transaction() carries the
// app.tenant_id GUC that RLS requires. Without this the suite exercised the
// HTTP layer only and could not see that the consumer never wrote anything.
registerF3_nps_Consumers({
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
const empNps = randomUUID();
const empGpf = randomUUID();
const empNps2 = randomUUID();

async function seedEmployee(id: string, scheme: string): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: "Test Emp",
      departmentId: deptId, designationId: desigId, dateOfJoining: "2015-06-01",
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
  await seedEmployee(empNps, "NPS");
  await seedEmployee(empNps2, "NPS");
  await seedEmployee(empGpf, "GPF");
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsNpsContributions).where(eq(hrmsNpsContributions.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

const pran = `110${randomUUID().replace(/[^0-9]/g, "").slice(0, 9).padEnd(9, "0")}`;

describe("NPS PRAN account", () => {
  it("rejects enrolment for a non-NPS (GPF) employee", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empGpf}/nps`, headers: HR,
      payload: { pran: "TESTPRAN01" } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_NPS_SCHEME");
  });

  it("enrols an NPS employee with an opening balance and lays an opening ledger row", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps`, headers: HR,
      payload: { pran, tier: "I", openingEmpMinor: 100000, openingErMinor: 140000 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empNps}/nps`, headers: HR });
    await drainF3();
    const body = get.json();
    expect(body.runningBalanceMinor).toBe("240000");
    expect(body.employeeBalanceMinor).toBe("100000");
    expect(body.employerBalanceMinor).toBe("140000");
    expect(body.contributions).toHaveLength(1);
    expect(body.contributions[0].entryType).toBe("opening");
  });

  it("rejects a duplicate NPS account", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps`, headers: HR,
      payload: { pran: "OTHERPRAN1" } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NPS_EXISTS");
  });

  it("posts monthly contributions and carries a real running balance", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/contribution`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 78540 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("374640"); // 240000 + 134640

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/contribution`, headers: HR,
      payload: { period: "2026-05", empAmountMinor: 56100, erAmountMinor: 78540 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("509280");
    expect(res.json().employeeBalanceMinor).toBe("212200");
    expect(res.json().employerBalanceMinor).toBe("297080");
  });

  it("is idempotent per period — re-posting the same month is rejected", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/contribution`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 78540 } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PERIOD_ALREADY_POSTED");
  });

  it("processes a withdrawal and guards against overdraft", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/withdrawal`, headers: HR,
      payload: { amountMinor: 9280 } });
    await drainF3();
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("500000");

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/withdrawal`, headers: HR,
      payload: { amountMinor: 999999999 } });
    await drainF3();
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INSUFFICIENT_BALANCE");
  });

  it("statement reflects the full ledger and final running balance", async () => {
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empNps}/nps`, headers: HR });
    await drainF3();
    const body = get.json();
    expect(body.runningBalanceMinor).toBe("500000");
    // opening + 2 contributions + 1 withdrawal
    expect(body.contributions).toHaveLength(4);
    const types = body.contributions.map((c: { entryType: string }) => c.entryType);
    expect(types).toEqual(["opening", "contribution", "contribution", "withdrawal"]);
  });

  it("validates the period format", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/contribution`, headers: HR,
      payload: { period: "April", empAmountMinor: 1 } });
    await drainF3();
    expect(res.statusCode).toBe(400);
  });

  it("404s for an employee without an NPS account", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/employees/${randomUUID()}/nps`, headers: HR });
    await drainF3();
    expect(res.statusCode).toBe(404);
  });
  /**
   * End-to-end proof of the F3 NPS consumer over a real database, on its own
   * employee so it does not depend on the sequential fixtures above.
   *
   * Before the consumer fix every one of these writes threw a ReferenceError
   * inside the async consumer (`acct`, `empAmt`, `amount`, `ledgerId` … were
   * never declared) while the HTTP layer reported success, so the contribution
   * ledger stayed empty. Assertions are made on the PERSISTED statement rather
   * than on the POST responses: routes.ts still destructures a `{ prev, next }`
   * that publishF3Write does not return, so contribution/withdrawal answer 500
   * even though the write itself is queued and applied. That response-shape
   * defect lives in routes.ts and is out of this batch's scope; the ledger
   * below is what must be right.
   */
  it("consumer writes the full NPS ledger with correct running balances", async () => {
    const url = `/v1/hrms/employees/${empNps2}/nps`;
    const pran2 = `220${randomUUID().replace(/[^0-9]/g, "").slice(0, 9).padEnd(9, "0")}`;
    const statement = async () => {
      const g = await app.inject({ method: "GET", url, headers: HR });
      return g.json();
    };

    await app.inject({ method: "POST", url, headers: HR,
      payload: { pran: pran2, tier: "I", openingEmpMinor: 100000, openingErMinor: 140000 } });
    await drainF3();
    let st = await statement();
    expect(st.runningBalanceMinor).toBe("240000");
    expect(st.employeeBalanceMinor).toBe("100000");
    expect(st.employerBalanceMinor).toBe("140000");

    // two monthly contributions carry a real running balance
    await app.inject({ method: "POST", url: `${url}/contribution`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 78540 } });
    await drainF3();
    expect((await statement()).runningBalanceMinor).toBe("374640");

    await app.inject({ method: "POST", url: `${url}/contribution`, headers: HR,
      payload: { period: "2026-05", empAmountMinor: 56100, erAmountMinor: 78540 } });
    await drainF3();
    st = await statement();
    expect(st.runningBalanceMinor).toBe("509280");
    expect(st.employeeBalanceMinor).toBe("212200");
    expect(st.employerBalanceMinor).toBe("297080");

    // idempotent per period — re-posting the same month must not double-count
    await app.inject({ method: "POST", url: `${url}/contribution`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 78540 } });
    await drainF3();
    expect((await statement()).runningBalanceMinor).toBe("509280");

    // withdrawal draws the EMPLOYER leg down first
    await app.inject({ method: "POST", url: `${url}/withdrawal`, headers: HR, payload: { amountMinor: 9280 } });
    await drainF3();
    st = await statement();
    expect(st.runningBalanceMinor).toBe("500000");
    expect(st.employerBalanceMinor).toBe("287800");
    expect(st.employeeBalanceMinor).toBe("212200");

    // overdraft is refused by the consumer — the corpus must be untouched
    await app.inject({ method: "POST", url: `${url}/withdrawal`, headers: HR, payload: { amountMinor: 999999999 } });
    await drainF3();
    st = await statement();
    expect(st.runningBalanceMinor).toBe("500000");
    expect(st.contributions.map((c: { entryType: string }) => c.entryType))
      .toEqual(["opening", "contribution", "contribution", "withdrawal"]);
  });
});
