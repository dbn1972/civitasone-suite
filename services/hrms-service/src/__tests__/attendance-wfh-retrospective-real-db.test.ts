/**
 * GAP-HR-WFH-06 (owner decision, 26 Nov 2026): retrospective WFH.
 * Employee: no back-dating. HR: up to 7 days back, with a reason. Real DB, no mocks.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import { withTenantScope } from "@civitasone/db";
import { addDays, istToday } from "@civitasone/schemas/validators";
import { buildApp } from "../app.js";
import { db, sqlClient } from "../shared/db.js";
import { hrmsEmployees } from "../modules/employee/schema.js";
import type { FastifyInstance } from "fastify";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = randomUUID();
const SEED_ACTOR = randomUUID();
const EMP_SUB = "wfh-retro-employee";
const HR_SUB = "wfh-retro-hr";

function auth(sub: string, roles: string[]): { authorization: string } {
  return { authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "sess-wfh-retro" }, SECRET, 3600)}` };
}

let app: FastifyInstance;
let empId: string;

const post = (as: "employee" | "hr", fromDate: string, toDate: string, reason?: string) => app.inject({
  method: "POST", url: "/v1/hrms/wfh-requests",
  headers: as === "hr" ? auth(HR_SUB, ["hr_officer"]) : auth(EMP_SUB, ["employee"]),
  payload: { employeeId: empId, fromDate, toDate, ...(reason ? { reason } : {}) },
});

beforeAll(async () => {
  app = await buildApp();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await withTenantScope(db, TENANT, (tx: any) => tx.insert(hrmsEmployees).values({
    id: (empId = randomUUID()), tenantId: TENANT, userRef: EMP_SUB,
    employeeNo: "WFR-001", fullName: "Retro Test Employee",
    departmentId: randomUUID(), designationId: randomUUID(), dateOfJoining: "2020-01-15",
    createdBy: SEED_ACTOR, updatedBy: SEED_ACTOR,
  }));
});

afterAll(async () => {
  await app.close();
  await sqlClient.end();
});

describe("POST /v1/hrms/wfh-requests -- retrospective WFH (GAP-HR-WFH-06)", () => {
  const today = istToday();

  it("an employee filing for today is fine", async () => {
    expect((await post("employee", today, today)).statusCode).toBe(202);
  });

  it("an employee cannot file for yesterday (422 RETROSPECTIVE_WFH_NOT_ALLOWED), reason or not", async () => {
    const y = addDays(today, -1);
    const r = await post("employee", y, y, "I forgot to file this on the day itself");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("RETROSPECTIVE_WFH_NOT_ALLOWED");
  });

  it("HR can record a day 7 days back with a reason", async () => {
    const d = addDays(today, -7);
    expect((await post("hr", d, d, "worked from home during the road blockade; supervisor confirmed")).statusCode).toBe(202);
  });

  it("HR cannot go back 8 days (422 RETROSPECTIVE_WFH_WINDOW_EXCEEDED)", async () => {
    const d = addDays(today, -8);
    const r = await post("hr", d, d, "worked from home during the road blockade; supervisor confirmed");
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("RETROSPECTIVE_WFH_WINDOW_EXCEEDED");
  });

  it("HR must give a reason for a back-dated entry (422 RETROSPECTIVE_WFH_REASON_REQUIRED)", async () => {
    const d = addDays(today, -3);
    const r = await post("hr", d, d);
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("RETROSPECTIVE_WFH_REASON_REQUIRED");
  });
});
