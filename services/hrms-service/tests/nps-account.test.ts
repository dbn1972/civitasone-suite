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
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NOT_NPS_SCHEME");
  });

  it("enrols an NPS employee with an opening balance and lays an opening ledger row", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps`, headers: HR,
      payload: { pran, tier: "I", openingEmpMinor: 100000, openingErMinor: 140000 } });
    expect(res.statusCode).toBe(201);
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empNps}/nps`, headers: HR });
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
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("NPS_EXISTS");
  });

  it("posts monthly contributions and carries a real running balance", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/contribution`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 78540 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("374640"); // 240000 + 134640

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/contribution`, headers: HR,
      payload: { period: "2026-05", empAmountMinor: 56100, erAmountMinor: 78540 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("509280");
    expect(res.json().employeeBalanceMinor).toBe("212200");
    expect(res.json().employerBalanceMinor).toBe("297080");
  });

  it("is idempotent per period — re-posting the same month is rejected", async () => {
    const res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/contribution`, headers: HR,
      payload: { period: "2026-04", empAmountMinor: 56100, erAmountMinor: 78540 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PERIOD_ALREADY_POSTED");
  });

  it("processes a withdrawal and guards against overdraft", async () => {
    let res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/withdrawal`, headers: HR,
      payload: { amountMinor: 9280 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().balanceMinor).toBe("500000");

    res = await app.inject({ method: "POST", url: `/v1/hrms/employees/${empNps}/nps/withdrawal`, headers: HR,
      payload: { amountMinor: 999999999 } });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INSUFFICIENT_BALANCE");
  });

  it("statement reflects the full ledger and final running balance", async () => {
    const get = await app.inject({ method: "GET", url: `/v1/hrms/employees/${empNps}/nps`, headers: HR });
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
    expect(res.statusCode).toBe(400);
  });

  it("404s for an employee without an NPS account", async () => {
    const res = await app.inject({ method: "GET", url: `/v1/hrms/employees/${randomUUID()}/nps`, headers: HR });
    expect(res.statusCode).toBe(404);
  });
});
