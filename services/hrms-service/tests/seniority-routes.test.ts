/**
 * DOM-019 regression: `hrms.seniority.generate` / `hrms.seniority.approve`
 * had a real, correct consumer (fixed under DOM-004) but no producer
 * anywhere in the fleet — no route, no scheduled job, nothing ever called
 * `queue.publish` for either command, so the consumer was unreachable in
 * production.
 *
 * These tests prove the full path now works end-to-end through a real HTTP
 * caller: POST /v1/hrms/seniority/generate and POST
 * /v1/hrms/seniority/:id/approve publish the commands, the real consumer
 * (registered here exactly as worker.ts does in production) processes them,
 * and the result is a real, queryable row in the database — not just an
 * accepted HTTP response.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { eq } from "drizzle-orm";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { runWithTenant } from "@civitasone/db";
import type { MemoryQueue } from "@civitasone/queue";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { hrmsSeniorityLists, hrmsSeniorityListEntries } from "../src/modules/seniority/schema.js";
import { registerSeniorityConsumers } from "../src/modules/seniority/consumer.js";
import { buildApp } from "../src/app.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT  = "11111111-aaaa-4000-8000-0000000000d9";
const ACTOR   = "00000000-aaaa-4000-8000-0000000000d9";
const DEPT_1  = "77777777-aaaa-4000-8000-0000000000d9";
const DESIG_1 = "88888888-bbbb-4000-8000-0000000000d9";
const EMP_1   = "22222222-bbbb-4000-8000-0000000000d9";
const EMP_2   = "22222222-cccc-4000-8000-0000000000d9";

// worker.ts registers this consumer on the real queue in production; do the
// same here so a route's publish is actually picked up and processed, the
// way it would be by the live worker process.
registerSeniorityConsumers(queue);
async function drain() {
  await (queue as unknown as MemoryQueue).drain();
}

const tok = (roles = ["hr_admin"]) => signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });

async function wipe() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsSeniorityListEntries).where(eq(hrmsSeniorityListEntries.tenantId, TENANT));
    await tx.delete(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.tenantId, TENANT));
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
  }));
}

async function seedOrg() {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({
      id: DEPT_1, tenantId: TENANT, code: "DEPT-D19", name: "DOM-019 Dept",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsDesignations).values({
      id: DESIG_1, tenantId: TENANT, code: "DESIG-D19", name: "DOM-019 Designation",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMP_1, tenantId: TENANT, employeeNo: "EMP-D19-001", fullName: "Senior One",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2009-01-01",
      dateOfBirth: "1974-01-01", status: "confirmed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
    await tx.insert(hrmsEmployees).values({
      id: EMP_2, tenantId: TENANT, employeeNo: "EMP-D19-002", fullName: "Junior Two",
      departmentId: DEPT_1, designationId: DESIG_1, dateOfJoining: "2019-01-01",
      dateOfBirth: "1991-01-01", status: "confirmed",
      createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
}

beforeAll(async () => { await wipe(); await seedOrg(); });
afterAll(async () => { await wipe(); await sqlClient.end(); });

describe("POST /v1/hrms/seniority/generate — DOM-019 producer wired to the real DOM-004 consumer", () => {
  it("202s, publishes the command, and the consumer persists a real snapshot", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(), payload: { departmentId: DEPT_1, asOf: "2026-09-10" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBeDefined();
    expect(body.status).toBe("accepted");
    await app.close();

    // The 202 above is only proof the command was queued — drain the real
    // consumer and check the database for a real persisted row, the way
    // DOM-004's own test does.
    await drain();

    const lists = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, body.id))));
    expect(lists).toHaveLength(1);
    expect(lists[0]?.status).toBe("generated");
    expect(lists[0]?.entryCount).toBe(2);
    expect(lists[0]?.generatedBy).toBe(ACTOR);

    const entries = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityListEntries)
        .where(eq(hrmsSeniorityListEntries.seniorityListId, body.id))));
    expect(entries).toHaveLength(2);
    const byRank = [...entries].sort((a, b) => a.rank - b.rank);
    expect(byRank[0]?.employeeNo).toBe("EMP-D19-001"); // joined 2009 -> senior -> rank 1
    expect(byRank[1]?.employeeNo).toBe("EMP-D19-002");
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/seniority/generate", payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager (read-only role) cannot trigger generate", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(["manager"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("400 — invalid departmentId", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(), payload: { departmentId: "not-a-uuid" },
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

describe("POST /v1/hrms/seniority/:id/approve — DOM-019 producer wired to the real DOM-004 consumer", () => {
  it("202s, publishes the command, and the consumer flips the list to approved", async () => {
    // Generate a real list first via the real route (full chain, not a
    // hand-seeded row), then approve it via the real route too.
    const genApp = await buildApp();
    const genRes = await genApp.inject({
      method: "POST", url: "/v1/hrms/seniority/generate",
      headers: auth(), payload: { departmentId: DEPT_1, asOf: "2026-09-10" },
    });
    const listId = genRes.json().id as string;
    await genApp.close();
    await drain();

    const approveApp = await buildApp();
    const r = await approveApp.inject({
      method: "POST", url: `/v1/hrms/seniority/${listId}/approve`,
      headers: auth(), payload: { remarks: "verified end-to-end for DOM-019" },
    });
    expect(r.statusCode).toBe(202);
    const body = r.json();
    expect(body.id).toBe(listId);
    expect(body.status).toBe("accepted");
    await approveApp.close();

    await drain();

    const lists = await runWithTenant(TENANT, () => db.transaction(async (tx) =>
      tx.select().from(hrmsSeniorityLists).where(eq(hrmsSeniorityLists.id, listId))));
    expect(lists).toHaveLength(1);
    expect(lists[0]?.status).toBe("approved");
    expect(lists[0]?.approvedBy).toBe(ACTOR);
    expect(lists[0]?.approvedAt).not.toBeNull();
    expect(lists[0]?.remarks).toBe("verified end-to-end for DOM-019");
  });

  it("401 — no auth header", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/seniority/${EMP_1}/approve`, payload: {},
    });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("403 — manager (read-only role) cannot approve", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/seniority/${EMP_1}/approve`,
      headers: auth(["manager"]), payload: {},
    });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("400 — invalid id param", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/seniority/not-a-uuid/approve",
      headers: auth(), payload: {},
    });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});
