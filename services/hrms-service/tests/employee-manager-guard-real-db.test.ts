/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-05 (real Postgres): who may be set as an
 * employee's manager through the GENERIC PATCH /v1/hrms/employees/:id, and
 * the directory list the manager picker searches.
 *
 *  - PATCH route: managerId = self, an unknown id, an exited (terminated /
 *    separated / retired) colleague, or someone who already reports to the
 *    employee (a loop) is refused synchronously with a 422 and NOTHING is
 *    queued. A serving colleague is accepted (202). An UNCHANGED managerId is
 *    not re-validated, so an unrelated edit is never blocked because the
 *    current manager has since left.
 *  - Consumer: the same rule is re-checked inside the write transaction, so a
 *    command that slipped past the route (or went stale in the queue) cannot
 *    persist a bad manager.
 *  - GET /v1/hrms/employees: limit=500 is accepted and 501 is a 400;
 *    ?excludeStatuses= drops exited staff in the query itself (so a 20-row
 *    picker page is never spent on people who cannot be chosen); an unknown
 *    status in the filter is a 400; ?status= keeps returning only that status.
 *
 * Real async command -> consumer path (registerEmployeeConsumers + drain),
 * same convention as tests/employee-status-guards-real-db.test.ts. Fresh
 * random tenant per run; employees is FORCE RLS so every direct read/write
 * goes through runWithTenant.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { signToken } from "@civitasone/auth";
import { runWithTenant } from "@civitasone/db";
import { db, sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import { buildApp } from "../src/app.js";
import { registerEmployeeConsumers } from "../src/modules/employee/consumer.js";
import { hrmsEmployees, hrmsDepartments, hrmsDesignations } from "../src/modules/employee/schema.js";
import { COMMANDS } from "../src/topics.js";
import type { FastifyInstance } from "fastify";
import type { MemoryQueue } from "@civitasone/queue";

registerEmployeeConsumers(queue);
const drain = (): Promise<void> => (queue as unknown as MemoryQueue).drain();

const TENANT = randomUUID();
const ACTOR = randomUUID();
// vitest.config.ts injects JWT_SECRET for every suite -- never a literal here (gitleaks scans every commit).
const SECRET = process.env.JWT_SECRET as string;
const deptId = randomUUID();
const desigId = randomUUID();
const auth = (roles = ["hr_admin"]) => ({
  authorization: `Bearer ${signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s" }, SECRET)}`,
  "content-type": "application/json",
});

let app: FastifyInstance;

async function seedEmployee(status: string, managerId: string | null = null, label = "Mgr Guard"): Promise<string> {
  const id = randomUUID();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsEmployees).values({
      id, tenantId: TENANT, employeeNo: `E-${id.slice(0, 8)}`, fullName: `${label} ${status} ${id.slice(0, 4)}`,
      departmentId: deptId, designationId: desigId, dateOfJoining: "2015-01-01",
      status, employeeType: "permanent", managerId, createdBy: ACTOR, updatedBy: ACTOR,
    });
  }));
  return id;
}

async function managerOf(id: string): Promise<string | null> {
  const rows = await runWithTenant(TENANT, () => db.transaction((tx) => tx.select({ managerId: hrmsEmployees.managerId })
    .from(hrmsEmployees).where(and(eq(hrmsEmployees.id, id), eq(hrmsEmployees.tenantId, TENANT))).limit(1)));
  return rows[0]?.managerId ?? null;
}

/** Employees seeded by the id-case tests; named apart from "Mgr Guard" so they never enter the picker-search assertions. */
const seedCaseGuard = (status: string, managerId: string | null = null): Promise<string> => seedEmployee(status, managerId, "Case Guard");

const patch = (id: string, payload: Record<string, unknown>) =>
  app.inject({ method: "PATCH", url: `/v1/hrms/employees/${id}`, headers: auth(), payload });

beforeAll(async () => {
  app = await buildApp();
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.insert(hrmsDepartments).values({ id: deptId, tenantId: TENANT, code: "MG", name: "Mgr Guard Dept", createdBy: ACTOR, updatedBy: ACTOR });
    await tx.insert(hrmsDesignations).values({ id: desigId, tenantId: TENANT, code: "MG", name: "Mgr Guard Designation", createdBy: ACTOR, updatedBy: ACTOR });
  }));
});

afterAll(async () => {
  await runWithTenant(TENANT, () => db.transaction(async (tx) => {
    await tx.delete(hrmsEmployees).where(eq(hrmsEmployees.tenantId, TENANT));
    await tx.delete(hrmsDesignations).where(eq(hrmsDesignations.tenantId, TENANT));
    await tx.delete(hrmsDepartments).where(eq(hrmsDepartments.tenantId, TENANT));
  }));
  await app.close();
  await sqlClient.end();
});

describe("PATCH /v1/hrms/employees/:id managerId -- eligibility (route)", () => {
  it("refuses self as manager with 422 CYCLE_DETECTED and queues nothing", async () => {
    const emp = await seedEmployee("confirmed");
    const publish = vi.spyOn(queue, "publish");
    const r = await patch(emp, { managerId: emp });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("CYCLE_DETECTED");
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    expect(await managerOf(emp)).toBeNull();
  });

  // zod .uuid() accepts upper-case hex and Postgres matches uuids case-insensitively,
  // so the same employee can be spelled two ways -- the guard must not be fooled.
  it("refuses self when the URL id is upper-case and the body managerId is lower-case (422 CYCLE_DETECTED)", async () => {
    const emp = await seedCaseGuard("confirmed");
    const publish = vi.spyOn(queue, "publish");
    const r = await patch(emp.toUpperCase(), { managerId: emp });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("CYCLE_DETECTED");
    expect(publish).not.toHaveBeenCalled();
    publish.mockRestore();
    expect(await managerOf(emp)).toBeNull();
  });

  it("refuses self when the URL id is lower-case and the body managerId is upper-case (422 CYCLE_DETECTED)", async () => {
    const emp = await seedCaseGuard("confirmed");
    const r = await patch(emp, { managerId: emp.toUpperCase() });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("CYCLE_DETECTED");
    expect(await managerOf(emp)).toBeNull();
  });

  it("refuses a loop when the employee is addressed with an upper-case id", async () => {
    const boss = await seedCaseGuard("confirmed");
    const mid = await seedCaseGuard("confirmed", boss);
    const leaf = await seedCaseGuard("confirmed", mid);
    const r = await patch(boss.toUpperCase(), { managerId: leaf });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("CYCLE_DETECTED");
    await drain();
    expect(await managerOf(boss)).toBeNull();
  });

  it("treats an upper-case spelling of the CURRENT manager as unchanged (not re-validated)", async () => {
    const gone = await seedCaseGuard("separated");
    const emp = await seedCaseGuard("confirmed", gone);
    const r = await patch(emp, { managerId: gone.toUpperCase(), email: "unchanged.case@example.gov.in" });
    expect(r.statusCode).toBe(202);
  });

  it("refuses a manager id that does not exist in the tenant (422 INVALID_MANAGER)", async () => {
    const emp = await seedEmployee("confirmed");
    const r = await patch(emp, { managerId: randomUUID() });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_MANAGER");
    expect(await managerOf(emp)).toBeNull();
  });

  it.each(["terminated", "separated", "retired"])("refuses an exited manager (status %s) with 422 INVALID_MANAGER", async (status) => {
    const emp = await seedEmployee("confirmed");
    const gone = await seedEmployee(status);
    const r = await patch(emp, { managerId: gone });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_MANAGER");
    await drain();
    expect(await managerOf(emp)).toBeNull();
  });

  it("refuses a manager who already reports (transitively) to this employee", async () => {
    const boss = await seedEmployee("confirmed");
    const mid = await seedEmployee("confirmed", boss);
    const leaf = await seedEmployee("confirmed", mid);
    const r = await patch(boss, { managerId: leaf });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("CYCLE_DETECTED");
    await drain();
    expect(await managerOf(boss)).toBeNull();
  });

  it("accepts a serving colleague (202) and applies it through the consumer", async () => {
    const emp = await seedEmployee("confirmed");
    const mgr = await seedEmployee("on_leave"); // temporary absence: still a legitimate manager
    const r = await patch(emp, { managerId: mgr });
    expect(r.statusCode).toBe(202);
    await drain();
    expect(await managerOf(emp)).toBe(mgr);
  });

  it("does not re-validate an UNCHANGED managerId (an unrelated edit is not blocked by a manager who has since left)", async () => {
    const gone = await seedEmployee("separated");
    const emp = await seedEmployee("confirmed", gone);
    const r = await patch(emp, { managerId: gone, email: "unchanged.mgr@example.gov.in" });
    expect(r.statusCode).toBe(202);
  });
});

describe("employee update consumer -- managerId re-check inside the write transaction", () => {
  async function publishUpdate(payload: Record<string, unknown>): Promise<void> {
    const messageId = randomUUID();
    await queue.publish(COMMANDS.employeeUpdate, {
      messageId, type: COMMANDS.employeeUpdate, tenantId: TENANT, actorId: ACTOR,
      correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { tenantId: TENANT, ...payload },
    });
    await drain();
  }

  it("does not persist self as manager even when the command bypassed the route", async () => {
    const emp = await seedEmployee("confirmed");
    await publishUpdate({ id: emp, managerId: emp });
    expect(await managerOf(emp)).toBeNull();
  });

  it("does not persist self as manager when the command spells the ids in different cases", async () => {
    const emp = await seedCaseGuard("confirmed");
    await publishUpdate({ id: emp.toUpperCase(), managerId: emp });
    expect(await managerOf(emp)).toBeNull();
  });

  it("does not persist an exited manager even when the command bypassed the route", async () => {
    const emp = await seedEmployee("confirmed");
    const gone = await seedEmployee("terminated");
    await publishUpdate({ id: emp, managerId: gone });
    expect(await managerOf(emp)).toBeNull();
  });

  it("still applies a valid manager from the queue", async () => {
    const emp = await seedEmployee("confirmed");
    const mgr = await seedEmployee("confirmed");
    await publishUpdate({ id: emp, managerId: mgr });
    expect(await managerOf(emp)).toBe(mgr);
  });
});

describe("GET /v1/hrms/employees -- limit, status and excludeStatuses", () => {
  let activeId = "";
  let separatedId = "";
  let probationId = "";
  beforeAll(async () => {
    activeId = await seedEmployee("confirmed");
    separatedId = await seedEmployee("separated");
    probationId = await seedEmployee("probation");
  });

  const list = (qs: string) => app.inject({ method: "GET", url: `/v1/hrms/employees?${qs}`, headers: auth() });
  const idsOf = (r: { json: () => unknown }) => (r.json() as { data: Array<{ id: string }> }).data.map((e) => e.id);

  it("accepts limit=500 and rejects limit=501 with 400 VALIDATION_FAILED", async () => {
    expect((await list("limit=500")).statusCode).toBe(200);
    const over = await list("limit=501");
    expect(over.statusCode).toBe(400);
    expect(over.json().code).toBe("VALIDATION_FAILED");
  });

  it("?status=separated returns only separated staff", async () => {
    const ids = idsOf(await list("limit=500&status=separated"));
    expect(ids).toContain(separatedId);
    expect(ids).not.toContain(activeId);
  });

  it("?excludeStatuses= drops exited staff in the query itself and keeps serving ones", async () => {
    const r = await list("limit=500&excludeStatuses=terminated,separated,retired");
    expect(r.statusCode).toBe(200);
    const ids = idsOf(r);
    expect(ids).toContain(activeId);
    expect(ids).toContain(probationId);
    expect(ids).not.toContain(separatedId);
    const statuses = (r.json() as { data: Array<{ status: string }> }).data.map((e) => e.status);
    expect(statuses.some((s) => ["terminated", "separated", "retired"].includes(s))).toBe(false);
  });

  it("combines with the picker's text search", async () => {
    const r = await list(`limit=20&q=${encodeURIComponent("Mgr Guard")}&excludeStatuses=separated`);
    expect(r.statusCode).toBe(200);
    expect(idsOf(r)).not.toContain(separatedId);
    expect(idsOf(r)).toContain(activeId);
  });

  it("rejects an unknown status in excludeStatuses with 400 instead of ignoring it", async () => {
    const r = await list("excludeStatuses=separated,bogus");
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("VALIDATION_FAILED");
  });
});
