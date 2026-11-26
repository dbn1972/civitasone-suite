/**
 * GAP-HR-CONFIRMATION-01 (owner decision, 26 Nov 2026), real Postgres, no mocks:
 *
 *   - the REPORTING MANAGER records the probation-confirmation recommendation
 *     (POST /v1/hrms/employees/:id/confirmation-recommendation, 202 + consumer);
 *   - GET /v1/hrms/confirmations carries managerRecommendation ("pending" until one is
 *     recorded) and is scoped to the caller's direct reports for a manager;
 *   - HR confirms; with NO recommendation (or a not_recommended one) an override remark of
 *     at least 10 characters is REQUIRED (422), and lands in the audit event.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../shared/db.js";
import { queue } from "../shared/infra.js";
import { buildApp } from "../app.js";
import { registerEmployeeConsumers } from "../modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations, hrmsConfirmationRecommendations } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

registerEmployeeConsumers(queue);
const drain = async (): Promise<void> => { await (queue as unknown as MemoryQueue).drain(); };

const TENANT = randomUUID();
const HR_ACTOR = randomUUID();
const MGR_SUB = randomUUID();
const OTHER_MGR_SUB = randomUUID();
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const deptId = randomUUID();
const desigId = randomUUID();
let mgrEmpId: string;
let otherMgrEmpId: string;
let app: FastifyInstance;

const auth = (sub: string, roles: string[]) => ({
  authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s-cfr" }, SECRET)}`,
  "content-type": "application/json",
});
const hr = () => auth(HR_ACTOR, ["hr_officer"]);

async function seedEmployee(name: string, over: Partial<typeof hrmsEmployees.$inferInsert> = {}): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: name,
      departmentId: deptId, designationId: desigId, dateOfJoining: "2024-01-01",
      status: "probation", employeeType: "permanent", createdBy: HR_ACTOR, updatedBy: HR_ACTOR, ...over,
    });
  }));
  return id;
}

async function recommendations(employeeId: string): Promise<Array<{ recommendation: string; remark: string | null; recordedBy: string }>> {
  return runWithTenant(TENANT, () => db.transaction((tx) => tx.select({
    recommendation: hrmsConfirmationRecommendations.recommendation, remark: hrmsConfirmationRecommendations.remark,
    recordedBy: hrmsConfirmationRecommendations.recordedBy,
  }).from(hrmsConfirmationRecommendations)
    .where(and(eq(hrmsConfirmationRecommendations.tenantId, TENANT), eq(hrmsConfirmationRecommendations.employeeId, employeeId)))));
}

async function seedRecommendation(employeeId: string, recommendation: string, remark: string | null = null): Promise<void> {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsConfirmationRecommendations).values({
      tenantId: TENANT, employeeId, recommendation, remark, recordedBy: HR_ACTOR, createdBy: HR_ACTOR, updatedBy: HR_ACTOR,
    });
  }));
}

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "CFR1", name: "Revenue Department", createdBy: HR_ACTOR, updatedBy: HR_ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "CFRS1", name: "Assistant Section Officer", createdBy: HR_ACTOR, updatedBy: HR_ACTOR });
  }));
  mgrEmpId = await seedEmployee("Meena Iyer (reporting manager)", { userRef: MGR_SUB, status: "confirmed" });
  otherMgrEmpId = await seedEmployee("Rakesh Sharma (another manager)", { userRef: OTHER_MGR_SUB, status: "confirmed" });
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsConfirmationRecommendations).where(eq(hrmsConfirmationRecommendations.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/hrms/employees/:id/confirmation-recommendation", () => {
  it("the reporting manager records a recommendation: 202, then the consumer appends a history row", async () => {
    const emp = await seedEmployee("Anil Kumar", { managerId: mgrEmpId });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${emp}/confirmation-recommendation`,
      headers: auth(MGR_SUB, ["manager"]), payload: { recommendation: "recommended", remark: "Good work through probation" },
    });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await recommendations(emp)).toEqual([{ recommendation: "recommended", remark: "Good work through probation", recordedBy: expect.any(String) }]);
  });

  it("a manager who is NOT this employee's reporting manager gets 403 NOT_REPORTING_MANAGER", async () => {
    const emp = await seedEmployee("Sunita Devi", { managerId: mgrEmpId });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${emp}/confirmation-recommendation`,
      headers: auth(OTHER_MGR_SUB, ["manager"]), payload: { recommendation: "recommended" },
    });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_REPORTING_MANAGER");
    await drain();
    expect(await recommendations(emp)).toHaveLength(0);
  });

  it("HR and plain employees cannot record one (403)", async () => {
    const emp = await seedEmployee("Pooja Nair", { managerId: mgrEmpId });
    for (const roles of [["hr_officer"], ["hr_admin"], ["employee"]]) {
      const r = await app.inject({
        method: "POST", url: `/v1/hrms/employees/${emp}/confirmation-recommendation`,
        headers: auth(HR_ACTOR, roles), payload: { recommendation: "recommended" },
      });
      expect(r.statusCode, roles.join()).toBe(403);
    }
  });

  it("a not_recommended recommendation must say why (400); an employee no longer on probation is 409", async () => {
    const emp = await seedEmployee("Vikram Singh", { managerId: mgrEmpId });
    const bare = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${emp}/confirmation-recommendation`,
      headers: auth(MGR_SUB, ["manager"]), payload: { recommendation: "not_recommended", remark: "poor" },
    });
    expect(bare.statusCode).toBe(400);
    const done = await seedEmployee("Already Confirmed", { managerId: mgrEmpId, status: "confirmed" });
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/employees/${done}/confirmation-recommendation`,
      headers: auth(MGR_SUB, ["manager"]), payload: { recommendation: "recommended" },
    });
    expect(r.statusCode).toBe(409);
  });

  it("a manager can change their mind: both rows are kept, the latest is the current one", async () => {
    const emp = await seedEmployee("Latha Menon", { managerId: mgrEmpId });
    await app.inject({ method: "POST", url: `/v1/hrms/employees/${emp}/confirmation-recommendation`, headers: auth(MGR_SUB, ["manager"]), payload: { recommendation: "recommended" } });
    await drain();
    await new Promise((res) => setTimeout(res, 15));
    await app.inject({ method: "POST", url: `/v1/hrms/employees/${emp}/confirmation-recommendation`, headers: auth(MGR_SUB, ["manager"]), payload: { recommendation: "not_recommended", remark: "Attendance has slipped since August" } });
    await drain();
    expect(await recommendations(emp)).toHaveLength(2);
    const list = (await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: hr() })).json().data as Array<{ id: string; managerRecommendation: string }>;
    expect(list.find((x) => x.id === emp)?.managerRecommendation).toBe("not_recommended");
  });
});

describe("GET /v1/hrms/confirmations", () => {
  it("shows 'pending' until recorded, and the recorded value after", async () => {
    const emp = await seedEmployee("Deepak Joshi", { managerId: mgrEmpId });
    const before = (await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: hr() })).json().data as Array<{ id: string; managerRecommendation: string }>;
    expect(before.find((x) => x.id === emp)?.managerRecommendation).toBe("pending");
    await seedRecommendation(emp, "recommended", "Meets all targets");
    const after = (await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: hr() })).json().data as Array<{ id: string; managerRecommendation: string; managerRecommendationRemark: string | null }>;
    expect(after.find((x) => x.id === emp)).toMatchObject({ managerRecommendation: "recommended", managerRecommendationRemark: "Meets all targets" });
  });

  it("a manager sees only their own direct reports on probation", async () => {
    const mine = await seedEmployee("My Probationer", { managerId: mgrEmpId });
    const theirs = await seedEmployee("Someone Else's Probationer", { managerId: otherMgrEmpId });
    const r = await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: auth(MGR_SUB, ["manager"]) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it("a manager not linked to any employee record sees nothing", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: auth(randomUUID(), ["manager"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]);
  });

  it("a plain employee is refused (403)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/confirmations", headers: auth(randomUUID(), ["employee"]) });
    expect(r.statusCode).toBe(403);
  });
});

describe("PATCH /v1/hrms/employees/:id/confirm -- override remark", () => {
  const confirm = (id: string, extra: Record<string, unknown> = {}) => app.inject({
    method: "PATCH", url: `/v1/hrms/employees/${id}/confirm`, headers: hr(),
    payload: { confirmationDate: "2026-11-20", orderRef: "CONFIRM/2026/310", ...extra },
  });

  it("with NO recommendation on record, confirming needs an override remark (422)", async () => {
    const emp = await seedEmployee("No Recommendation Yet", { managerId: mgrEmpId });
    const r = await confirm(emp);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("CONFIRMATION_OVERRIDE_REMARK_REQUIRED");
    expect((await confirm(emp, { overrideRemark: "too short" })).statusCode).toBe(422);
  });

  it("with an override remark of 10+ characters it is accepted (202)", async () => {
    const emp = await seedEmployee("Manager On Long Leave", { managerId: mgrEmpId });
    const r = await confirm(emp, { overrideRemark: "Manager on medical leave; HOD vouches for the work" });
    expect(r.statusCode).toBe(202);
  });

  it("a 'recommended' recommendation needs no override remark", async () => {
    const emp = await seedEmployee("Recommended Employee", { managerId: mgrEmpId });
    await seedRecommendation(emp, "recommended");
    expect((await confirm(emp)).statusCode).toBe(202);
  });

  it("a 'not_recommended' recommendation still needs an override remark", async () => {
    const emp = await seedEmployee("Not Recommended Employee", { managerId: mgrEmpId });
    await seedRecommendation(emp, "not_recommended", "Repeated unauthorised absence");
    const refused = await confirm(emp);
    expect(refused.statusCode).toBe(422);
    expect(refused.json().message).toMatch(/did not recommend/);
    expect((await confirm(emp, { overrideRemark: "Disciplinary matter closed; confirm per HOD note" })).statusCode).toBe(202);
  });
});
