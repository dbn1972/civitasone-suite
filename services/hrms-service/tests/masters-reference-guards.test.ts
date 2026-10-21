/**
 * Department / designation delete guards -- real-DB proof.
 *
 * GAP-HR-DESIGNATIONS-02: DELETE /v1/hrms/designations/:id must refuse (409
 * DESIGNATION_IN_USE, nothing published) while ANY in-service table still
 * stores the id -- not just hrms_employees -- and the F3 consumer must repeat
 * the check so a reference created between the route's 202 and the consumer
 * running cannot be orphaned. GET ?withUsage=true exposes the same count per
 * row for the admin page.
 *
 * GAP-HR-DEPARTMENTS-02: same race guard for departments (consumer case
 * employee_masters_routes__3), plus the route-level 409 against a real DB.
 *
 * Connects directly as the runtime role with a fresh random tenant per suite
 * (same isolation pattern as tests/designations-guards.test.ts), so it is safe
 * against a shared Postgres. Every referenced table is FORCE RLS, so the
 * app.tenant_id GUC is set before each direct insert.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import type { MemoryQueue } from "@civitasone/queue";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { COMMANDS } from "../src/topics.js";
import { registerF3_employee_Consumers } from "../src/modules/employee/f3-consumer.js";
import { DESIGNATION_REFERRERS } from "../src/modules/employee/master-usage.js";

registerF3_employee_Consumers(queue);
const memQueue = queue as unknown as MemoryQueue;
async function drainF3(): Promise<void> {
  await memQueue.drain();
}

const DATABASE_URL = process.env.DATABASE_URL as string;
const JWT = process.env.JWT_SECRET as string;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;
const TENANT = randomUUID();
const ACTOR = randomUUID();

function token(roles: string[] = ["hr_admin"]) {
  return signToken({ sub: ACTOR, tid: TENANT, roles, sid: "s1" }, JWT);
}

async function setTenant() {
  await sql`select set_config('app.tenant_id', ${TENANT}, false)`;
}

const uniq = () => randomUUID().slice(0, 8);

async function insertDesignation() {
  const id = randomUUID();
  await setTenant();
  await sql`insert into employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by)
            values (${id}::uuid, ${TENANT}::uuid, ${"D" + uniq()}, 'Role', 0, ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  return id;
}

async function insertDepartment(parentId: string | null = null) {
  const id = randomUUID();
  await setTenant();
  await sql`insert into employee.hrms_departments (id, tenant_id, code, name, parent_id, created_by, updated_by)
            values (${id}::uuid, ${TENANT}::uuid, ${"P" + uniq()}, 'Dept', ${parentId}::uuid, ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  return id;
}

async function insertEmployee(departmentId: string, designationId: string, status = "confirmed") {
  const id = randomUUID();
  await setTenant();
  await sql`insert into employee.hrms_employees
              (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, status, created_by, updated_by)
            values (${id}::uuid, ${TENANT}::uuid, ${"E" + uniq()}, 'Test Employee', ${departmentId}::uuid, ${designationId}::uuid, now(), ${status}, ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  return id;
}

/** A real employee row (promotions/transfers carry an FK to employees). */
async function insertBystanderEmployee(): Promise<string> {
  const deptId = await insertDepartment();
  const otherDesig = await insertDesignation();
  return insertEmployee(deptId, otherDesig);
}

/**
 * One insert per designation referrer in master-usage.ts's
 * DESIGNATION_REFERRERS (employees are covered by their own tests). Each row
 * carries only the NOT NULL columns of its table plus the designation id.
 */
const REFERRERS: Array<[key: string, insert: (designationId: string) => Promise<void>]> = [
  ["seniorityLists", async (d) => {
    await sql`insert into seniority.hrms_seniority_lists (tenant_id, as_of, generated_by, designation_id)
              values (${TENANT}::uuid, '2026-01-01', ${ACTOR}::uuid, ${d}::uuid)`;
  }],
  ["seniorityEntries", async (d) => {
    const listId = randomUUID();
    await sql`insert into seniority.hrms_seniority_lists (id, tenant_id, as_of, generated_by)
              values (${listId}::uuid, ${TENANT}::uuid, '2026-01-01', ${ACTOR}::uuid)`;
    await sql`insert into seniority.hrms_seniority_list_entries
                (tenant_id, seniority_list_id, rank, employee_id, employee_no, full_name, designation_id, department_id, date_of_joining, qualifying_years)
              values (${TENANT}::uuid, ${listId}::uuid, 1, ${randomUUID()}::uuid, ${"E" + uniq()}, 'Listed', ${d}::uuid, ${randomUUID()}::uuid, '2020-01-01', 5)`;
  }],
  ["workforcePosts", async (d) => {
    await sql`insert into workforce_core.post (tenant_id, post_no, office_id, designation_id)
              values (${TENANT}::uuid, ${"POST-" + uniq()}, ${randomUUID()}::uuid, ${d}::uuid)`;
  }],
  ["manpowerPlans", async (d) => {
    await sql`insert into manpower.plans (tenant_id, plan_year, unit_id, cadre, created_by, designation_id)
              values (${TENANT}::uuid, 2027, ${randomUUID()}::uuid, 'Cadre', ${ACTOR}::uuid, ${d}::uuid)`;
  }],
  ["manpowerRequisitions", async (d) => {
    const planId = randomUUID();
    await sql`insert into manpower.plans (id, tenant_id, plan_year, unit_id, cadre, created_by)
              values (${planId}::uuid, ${TENANT}::uuid, 2027, ${randomUUID()}::uuid, 'Cadre', ${ACTOR}::uuid)`;
    await sql`insert into manpower.requisitions (tenant_id, plan_id, requisition_no, unit_id, cadre, requested_vacancies, job_opening_id, created_by, designation_id)
              values (${TENANT}::uuid, ${planId}::uuid, ${"MR-" + uniq()}, ${randomUUID()}::uuid, 'Cadre', 1, ${randomUUID()}::uuid, ${ACTOR}::uuid, ${d}::uuid)`;
  }],
  ["jobOpenings", async (d) => {
    await sql`insert into recruitment.hrms_job_openings (tenant_id, ref_no, title, department_id, created_by, updated_by, designation_id)
              values (${TENANT}::uuid, ${"JO-" + uniq()}, 'Opening', ${randomUUID()}::uuid, ${ACTOR}::uuid, ${ACTOR}::uuid, ${d}::uuid)`;
  }],
  ["recruitmentRequisitions", async (d) => {
    await sql`insert into recruitment.hrms_requisitions (tenant_id, requisition_no, title, created_by, updated_by, designation_id)
              values (${TENANT}::uuid, ${"RQ-" + uniq()}, 'Requisition', ${ACTOR}::uuid, ${ACTOR}::uuid, ${d}::uuid)`;
  }],
  ["assessmentBlueprints", async (d) => {
    await sql`insert into assessment.hrms_assessment_blueprints (tenant_id, code, title, duration_minutes, created_by, updated_by, designation_id)
              values (${TENANT}::uuid, ${"BP-" + uniq()}, 'Blueprint', 60, ${ACTOR}::uuid, ${ACTOR}::uuid, ${d}::uuid)`;
  }],
  ["sanctionedPosts", async (d) => {
    await sql`insert into reservation.hrms_sanctioned_posts (tenant_id, cadre, created_by, updated_by, designation_id)
              values (${TENANT}::uuid, ${"Cadre-" + uniq()}, ${ACTOR}::uuid, ${ACTOR}::uuid, ${d}::uuid)`;
  }],
  ["promotions", async (d) => {
    const employeeId = await insertBystanderEmployee();
    await setTenant();
    await sql`insert into lifecycle.hrms_promotions (tenant_id, employee_id, from_desig_id, to_desig_id, effective_date, created_by, updated_by)
              values (${TENANT}::uuid, ${employeeId}::uuid, ${randomUUID()}::uuid, ${d}::uuid, '2026-01-01', ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  }],
  ["transfers", async (d) => {
    const employeeId = await insertBystanderEmployee();
    await setTenant();
    await sql`insert into lifecycle.hrms_transfers (tenant_id, employee_id, from_dept_id, to_dept_id, from_desig_id, effective_date, created_by, updated_by)
              values (${TENANT}::uuid, ${employeeId}::uuid, ${randomUUID()}::uuid, ${randomUUID()}::uuid, ${d}::uuid, '2026-01-01', ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  }],
];

async function publishMasterDelete(op: string, targetId: string): Promise<string> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.f3RouteWrite, {
    messageId,
    type: COMMANDS.f3RouteWrite,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: randomUUID(),
    schemaVersion: "1.0",
    payload: { op, id: randomUUID(), tenantId: TENANT, body: {}, params: { id: targetId }, query: {} },
  });
  await drainF3();
  return messageId;
}

async function designationRowCount(id: string): Promise<number> {
  await setTenant();
  const rows = await sql`select id from employee.hrms_designations where id = ${id}::uuid`;
  return rows.length;
}

async function departmentRowCount(id: string): Promise<number> {
  await setTenant();
  const rows = await sql`select id from employee.hrms_departments where id = ${id}::uuid`;
  return rows.length;
}

async function auditEventsFor(resourceId: string) {
  return sql`select payload from _outbox.messages
             where tenant_id = ${TENANT}::uuid and event_type = 'audit.event.record' and payload->>'resourceId' = ${resourceId}`;
}

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
});

afterAll(async () => {
  await setTenant();
  for (const stmt of [
    sql`delete from seniority.hrms_seniority_list_entries where tenant_id = ${TENANT}::uuid`,
    sql`delete from seniority.hrms_seniority_lists where tenant_id = ${TENANT}::uuid`,
    sql`delete from workforce_core.post where tenant_id = ${TENANT}::uuid`,
    sql`delete from manpower.plans where tenant_id = ${TENANT}::uuid`,
    sql`delete from recruitment.hrms_job_openings where tenant_id = ${TENANT}::uuid`,
    sql`delete from recruitment.hrms_requisitions where tenant_id = ${TENANT}::uuid`,
    sql`delete from assessment.hrms_assessment_blueprints where tenant_id = ${TENANT}::uuid`,
    sql`delete from reservation.hrms_sanctioned_posts where tenant_id = ${TENANT}::uuid`,
    sql`delete from lifecycle.hrms_promotions where tenant_id = ${TENANT}::uuid`,
    sql`delete from lifecycle.hrms_transfers where tenant_id = ${TENANT}::uuid`,
    sql`delete from employee.hrms_employees where tenant_id = ${TENANT}::uuid`,
    sql`delete from employee.hrms_designations where tenant_id = ${TENANT}::uuid`,
    sql`delete from employee.hrms_departments where tenant_id = ${TENANT}::uuid`,
    sql`delete from _outbox.messages where tenant_id = ${TENANT}::uuid`,
  ]) {
    await stmt;
  }
  await sql.end();
});

describe("DELETE /v1/hrms/designations/:id -- GAP-HR-DESIGNATIONS-02 guards every in-service referrer", () => {
  it("this suite exercises every referrer the guard knows about (add a case when DESIGNATION_REFERRERS grows)", () => {
    const covered = new Set<string>(["employees", ...REFERRERS.map(([key]) => key)]);
    expect([...covered].sort()).toEqual(DESIGNATION_REFERRERS.map((r) => r.key).sort());
  });

  it.each(REFERRERS)("409s with a %s reference breakdown and keeps the designation", async (key, insert) => {
    const desigId = await insertDesignation();
    await setTenant();
    await insert(desigId);

    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/designations/${desigId}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();

    expect(r.statusCode).toBe(409);
    const body = r.json();
    expect(body.code).toBe("DESIGNATION_IN_USE");
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.references[key]).toBeGreaterThanOrEqual(1);
    expect(await designationRowCount(desigId)).toBe(1);
  });

  it("counts an exited employee too: their service record must not lose its designation", async () => {
    const desigId = await insertDesignation();
    const deptId = await insertDepartment();
    await insertEmployee(deptId, desigId, "terminated");

    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/designations/${desigId}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();

    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: "DESIGNATION_IN_USE", employeeCount: 1 });
  });

  it("is tenant-scoped: another tenant's reference to the same id does not block the delete", async () => {
    const desigId = await insertDesignation();
    const otherTenant = randomUUID();
    await sql`select set_config('app.tenant_id', ${otherTenant}, false)`;
    await sql`insert into workforce_core.post (tenant_id, post_no, office_id, designation_id)
              values (${otherTenant}::uuid, ${"POST-" + uniq()}, ${randomUUID()}::uuid, ${desigId}::uuid)`;

    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/designations/${desigId}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();
    expect(r.statusCode).toBe(202);

    await sql`select set_config('app.tenant_id', ${otherTenant}, false)`;
    await sql`delete from workforce_core.post where tenant_id = ${otherTenant}::uuid`;
  });
});

describe("F3 consumer employee_masters_routes__5 -- designation race guard", () => {
  it("skips the delete and dead-letters the command when a record references the designation by the time it runs", async () => {
    const desigId = await insertDesignation();
    await setTenant();
    // Reference created AFTER the route's synchronous check would have passed.
    await REFERRERS.find(([k]) => k === "workforcePosts")![1](desigId);

    const messageId = await publishMasterDelete("employee_masters_routes__5", desigId);

    expect(await designationRowCount(desigId)).toBe(1);
    const dead = memQueue.dlq.find((d) => d.msg.messageId === messageId);
    expect(dead?.error).toMatch(/DESIGNATION_IN_USE/);
    expect(await auditEventsFor(desigId)).toHaveLength(0);
  });

  it("deletes an unreferenced designation and enqueues an audit event in the same transaction", async () => {
    const desigId = await insertDesignation();

    await publishMasterDelete("employee_masters_routes__5", desigId);

    expect(await designationRowCount(desigId)).toBe(0);
    const events = await auditEventsFor(desigId);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ service: "hrms", action: "delete", resourceType: "designation", outcome: "success" });
  });
});

describe("GET /v1/hrms/designations?withUsage=true -- per-row usage count", () => {
  it("returns usageCount for HR admins: >0 for a referenced designation, 0 for a free one", async () => {
    const used = await insertDesignation();
    const free = await insertDesignation();
    await setTenant();
    await REFERRERS.find(([k]) => k === "sanctionedPosts")![1](used);

    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: "/v1/hrms/designations?withUsage=true", headers: { authorization: `Bearer ${token()}` } });
    await app.close();

    expect(r.statusCode).toBe(200);
    const rows = r.json().data as Array<{ id: string; usageCount?: number }>;
    expect(rows.find((x) => x.id === used)?.usageCount).toBe(1);
    expect(rows.find((x) => x.id === free)?.usageCount).toBe(0);
  });

  it("omits usageCount without the flag, and ignores the flag for roles that cannot delete", async () => {
    const desigId = await insertDesignation();

    const app = await buildApp();
    const plain = await app.inject({ method: "GET", url: "/v1/hrms/designations", headers: { authorization: `Bearer ${token()}` } });
    const officer = await app.inject({ method: "GET", url: "/v1/hrms/designations?withUsage=true", headers: { authorization: `Bearer ${token(["hr_officer"])}` } });
    await app.close();

    for (const res of [plain, officer]) {
      expect(res.statusCode).toBe(200);
      const row = (res.json().data as Array<{ id: string; usageCount?: number }>).find((x) => x.id === desigId);
      expect(row).toBeDefined();
      expect(row).not.toHaveProperty("usageCount");
    }
  });
});

describe("departments -- GAP-HR-DEPARTMENTS-02 delete guards against a real DB", () => {
  it("DELETE 409s DEPARTMENT_IN_USE (and keeps the row) for a department with a child", async () => {
    const parent = await insertDepartment();
    await insertDepartment(parent);

    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/departments/${parent}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();

    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: "DEPARTMENT_IN_USE", childCount: 1, employeeCount: 0 });
    expect(await departmentRowCount(parent)).toBe(1);
  });

  it("DELETE 409s DEPARTMENT_IN_USE for a department with an active employee, but an exited employee does not block it", async () => {
    const withActive = await insertDepartment();
    const desig = await insertDesignation();
    await insertEmployee(withActive, desig, "confirmed");
    const withExited = await insertDepartment();
    await insertEmployee(withExited, desig, "terminated");

    const app = await buildApp();
    const blocked = await app.inject({ method: "DELETE", url: `/v1/hrms/departments/${withActive}`, headers: { authorization: `Bearer ${token()}` } });
    const allowed = await app.inject({ method: "DELETE", url: `/v1/hrms/departments/${withExited}`, headers: { authorization: `Bearer ${token()}` } });
    await app.close();

    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({ code: "DEPARTMENT_IN_USE", employeeCount: 1 });
    expect(allowed.statusCode).toBe(202);
  });
});

describe("F3 consumer employee_masters_routes__3 -- department race guard", () => {
  it("skips the delete and dead-letters the command when a child department appeared after the route's check", async () => {
    const parent = await insertDepartment();
    await insertDepartment(parent);

    const messageId = await publishMasterDelete("employee_masters_routes__3", parent);

    expect(await departmentRowCount(parent)).toBe(1);
    const dead = memQueue.dlq.find((d) => d.msg.messageId === messageId);
    expect(dead?.error).toMatch(/DEPARTMENT_IN_USE/);
    expect(await auditEventsFor(parent)).toHaveLength(0);
  });

  it("skips the delete when an active employee was assigned after the route's check", async () => {
    const dept = await insertDepartment();
    const desig = await insertDesignation();
    await insertEmployee(dept, desig, "probation");

    const messageId = await publishMasterDelete("employee_masters_routes__3", dept);

    expect(await departmentRowCount(dept)).toBe(1);
    expect(memQueue.dlq.some((d) => d.msg.messageId === messageId)).toBe(true);
  });

  it("deletes an empty, childless department and enqueues an audit event in the same transaction", async () => {
    const dept = await insertDepartment();

    await publishMasterDelete("employee_masters_routes__3", dept);

    expect(await departmentRowCount(dept)).toBe(0);
    const events = await auditEventsFor(dept);
    expect(events).toHaveLength(1);
    expect(events[0].payload).toMatchObject({ service: "hrms", action: "delete", resourceType: "department", outcome: "success" });
  });
});
