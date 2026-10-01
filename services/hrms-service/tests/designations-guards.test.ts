/**
 * Designation master-data guards (GAP-HR-DESIGNATIONS-02,
 * GAP-HR-DESIGNATIONS-NEW-02).
 *
 * Connects directly as the runtime role with a fresh random tenant per
 * suite (same isolation pattern as tests/manpower-rls.test.ts) so this is
 * safe to run concurrently with other worktrees/suites against a shared
 * dev Postgres -- nothing here depends on, or collides with,
 * tests/fixtures/core-seed.ts's fixed demo ids. hrms_designations and
 * hrms_employees are FORCE RLS (migrations/0026, 0034, 0103), so the
 * app.tenant_id GUC is set before every direct insert, exactly as
 * tests/manpower-rls.test.ts does for manpower.plans/requisitions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { signToken } from "@civitasone/auth";
import { buildApp } from "../src/app.js";
import { queue } from "../src/shared/infra.js";
import { registerF3_employee_Consumers } from "../src/modules/employee/f3-consumer.js";

// GAP-HR-DESIGNATIONS-04: the PATCH tests below need the actual F3 consumer
// to run (not just a 2xx from the route) to confirm the DB row itself ends
// up with payGrade NULL -- same reasoning/pattern as src/__tests__/
// department-routes.test.ts's injectF3/drainF3 helpers, adapted to this
// file's real-queue (not mocked) setup.
registerF3_employee_Consumers(queue);
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}

const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms";
const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sql: any;
const TENANT = randomUUID();
const ACTOR = randomUUID();

function token() {
  return signToken({ sub: ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s1" }, SECRET);
}

async function setTenant() {
  await sql`select set_config('app.tenant_id', ${TENANT}, false)`;
}

async function insertDesignation(code: string) {
  const id = randomUUID();
  await setTenant();
  await sql`insert into employee.hrms_designations (id, tenant_id, code, name, level, created_by, updated_by)
            values (${id}::uuid, ${TENANT}::uuid, ${code}, ${"Role " + code}, 0, ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  return id;
}

async function insertEmployeeWithDesignation(designationId: string) {
  const empId = randomUUID();
  const deptId = randomUUID();
  await setTenant();
  await sql`insert into employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
            values (${deptId}::uuid, ${TENANT}::uuid, ${"D" + empId.slice(0, 6)}, 'Test Dept', ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  await sql`insert into employee.hrms_employees
              (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
            values (${empId}::uuid, ${TENANT}::uuid, ${"E" + empId.slice(0, 6)}, 'Test Employee', ${deptId}::uuid, ${designationId}::uuid, now(), ${ACTOR}::uuid, ${ACTOR}::uuid)`;
  return { empId, deptId };
}

beforeAll(async () => {
  sql = postgres(DATABASE_URL, { max: 1 });
});

afterAll(async () => {
  await setTenant();
  await sql`delete from employee.hrms_employees where tenant_id = ${TENANT}::uuid`;
  await sql`delete from employee.hrms_designations where tenant_id = ${TENANT}::uuid`;
  await sql`delete from employee.hrms_departments where tenant_id = ${TENANT}::uuid`;
  await sql.end();
});

describe("DELETE /v1/hrms/designations/:id — GAP-HR-DESIGNATIONS-02 reference guard", () => {
  it("409s and does not delete when an employee still holds the designation", async () => {
    const desigId = await insertDesignation("KEEP1");
    await insertEmployeeWithDesignation(desigId);

    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/hrms/designations/${desigId}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: "DESIGNATION_IN_USE", count: 1 });

    await setTenant();
    const still = await sql`select id from employee.hrms_designations where id = ${desigId}::uuid`;
    expect(still.length).toBe(1);
  });

  it("202s (accepted for async delete) when nothing references the designation", async () => {
    const desigId = await insertDesignation("FREE1");

    const app = await buildApp();
    const r = await app.inject({
      method: "DELETE",
      url: `/v1/hrms/designations/${desigId}`,
      headers: { authorization: `Bearer ${token()}` },
    });
    await app.close();

    expect(r.statusCode).toBe(202);
  });
});

describe("POST /v1/hrms/designations — GAP-HR-DESIGNATIONS-NEW-02 duplicate-code guard", () => {
  it("409s on a case-insensitive duplicate code and does not publish a create", async () => {
    await insertDesignation("DUP1");

    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/designations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { code: "dup1", name: "Another Role" },
    });
    await app.close();

    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ code: "DUPLICATE_CODE" });

    await setTenant();
    const rows = await sql`select id from employee.hrms_designations where tenant_id = ${TENANT}::uuid and lower(code) = 'dup1'`;
    expect(rows.length).toBe(1);
  });

  it("202s for a genuinely new code", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "POST",
      url: "/v1/hrms/designations",
      headers: { authorization: `Bearer ${token()}` },
      payload: { code: "NEWC1", name: "Fresh Role" },
    });
    await app.close();

    expect(r.statusCode).toBe(202);
  });
});

/**
 * GAP-HR-DESIGNATIONS-04: PATCH used to be unable to actually clear
 * payGrade -- createDesignationBody's payGrade was `.optional()` only, so an
 * explicit `payGrade: null` 400'd (ZodError), which is why the web client
 * sent an empty string instead (stored as a literal "", visibly different
 * from a never-set NULL everywhere else this column is read back).
 */
describe("PATCH /v1/hrms/designations/:id — GAP-HR-DESIGNATIONS-04 payGrade null vs omitted", () => {
  it("clears payGrade to real NULL when the request sends payGrade: null", async () => {
    const desigId = await insertDesignation("CLR1");
    await setTenant();
    await sql`update employee.hrms_designations set pay_grade = 'PB-2' where id = ${desigId}::uuid`;

    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/designations/${desigId}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { payGrade: null },
    });
    await drainF3();
    await app.close();

    expect(r.statusCode).toBe(202);
    await setTenant();
    const rows = await sql`select pay_grade from employee.hrms_designations where id = ${desigId}::uuid`;
    expect(rows[0]?.pay_grade).toBeNull();
  });

  it("leaves payGrade untouched when the key is omitted entirely", async () => {
    const desigId = await insertDesignation("CLR2");
    await setTenant();
    await sql`update employee.hrms_designations set pay_grade = 'PB-3' where id = ${desigId}::uuid`;

    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/designations/${desigId}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { name: "Role CLR2 renamed" },
    });
    await drainF3();
    await app.close();

    expect(r.statusCode).toBe(202);
    await setTenant();
    const rows = await sql`select pay_grade from employee.hrms_designations where id = ${desigId}::uuid`;
    expect(rows[0]?.pay_grade).toBe("PB-3");
  });

  it("accepts level 0 + payGrade null (blank pay level) and stores 0 / NULL", async () => {
    const desigId = await insertDesignation("CLR3");
    await setTenant();
    await sql`update employee.hrms_designations set level = 5, pay_grade = 'PB-4' where id = ${desigId}::uuid`;

    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH",
      url: `/v1/hrms/designations/${desigId}`,
      headers: { authorization: `Bearer ${token()}` },
      payload: { level: 0, payGrade: null },
    });
    await drainF3();
    await app.close();

    expect(r.statusCode).toBe(202);
    await setTenant();
    const rows = await sql`select level, pay_grade from employee.hrms_designations where id = ${desigId}::uuid`;
    expect(rows[0]?.level).toBe(0);
    expect(rows[0]?.pay_grade).toBeNull();
  });
});
