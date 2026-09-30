/**
 * GAP-HR-DPC-01 (department/designation/pay-grade names on the seniority /
 * DPC-eligibility engine) and GAP-HR-DPC-04 (persisted seniority-list
 * summaries via the new GET /v1/hrms/seniority/lists) — real-DB round trip.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT      = "d9c00000-0000-4000-8000-000000000001";
const SEED_ACTOR   = "d9c00000-0000-4000-8000-0000000000a0";
const DEPT_ID      = "d9c00000-0000-4000-8000-0000000000d1";
const DESIG_ID     = "d9c00000-0000-4000-8000-0000000000d2";
const SENIOR_EMP_ID   = "d9c00000-0000-4000-8000-0000000000e1";
const JUNIOR_EMP_ID   = "d9c00000-0000-4000-8000-0000000000e2";
const SENIORITY_LIST_ID = "d9c00000-0000-4000-8000-0000000000f1";

const hrToken = signToken({ sub: "dpc-hr-admin", tid: TENANT, roles: ["hr_admin"], sid: "s-hr" }, SECRET);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM seniority.hrms_seniority_lists WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'DPCD', 'DPC Test Department', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, pay_grade, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'DPCDG', 'Section Officer', 'Grade B', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Senior: joined long ago, well past any minQualifyingYears default -> eligible.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${SENIOR_EMP_ID}, ${TENANT}, 'DPC-SR', 'Senior Officer', ${DEPT_ID}, ${DESIG_ID}, '2005-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // Junior: joined recently -> ineligible under the default 5-year minimum.
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${JUNIOR_EMP_ID}, ${TENANT}, 'DPC-JR', 'Junior Officer', ${DEPT_ID}, ${DESIG_ID}, '2024-06-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // GAP-HR-DPC-04: a persisted snapshot, seeded directly -- generate/approve
  // are async (queue-driven, processed by the separate worker process, not
  // by buildApp()'s HTTP-only app under test), so this simulates "a prior
  // consumer run already persisted a snapshot" rather than exercising the
  // queue round trip here.
  await asTenant((tx) => tx`
    INSERT INTO seniority.hrms_seniority_lists (id, tenant_id, as_of, status, entry_count, generated_by)
    VALUES (${SENIORITY_LIST_ID}, ${TENANT}, '2026-04-01', 'generated', 2, ${SEED_ACTOR})
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/dpc/eligibility — GAP-HR-DPC-01 department/designation/pay-grade names", () => {
  it("populates department, designation and grade as real names, not blank", async () => {
    const r = await app.inject({
      method: "GET",
      url: `/v1/hrms/dpc/eligibility?departmentId=${DEPT_ID}&asOf=2026-04-01`,
      headers: { authorization: `Bearer ${hrToken}` },
    });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as {
      eligible: Array<{ employeeNo: string; department: string; designation: string; grade: string }>;
      ineligible: Array<{ employeeNo: string; department: string; designation: string; grade: string }>;
    };

    const senior = body.eligible.find((e) => e.employeeNo === "DPC-SR");
    expect(senior).toBeDefined();
    expect(senior?.department).toBe("DPC Test Department");
    expect(senior?.designation).toBe("Section Officer");
    expect(senior?.grade).toBe("Grade B");

    const junior = body.ineligible.find((e) => e.employeeNo === "DPC-JR");
    expect(junior).toBeDefined();
    expect(junior?.department).toBe("DPC Test Department");
    expect(junior?.designation).toBe("Section Officer");
    expect(junior?.grade).toBe("Grade B");
  });
});

describe("GET /v1/hrms/seniority/lists — GAP-HR-DPC-04", () => {
  it("returns a persisted snapshot's summary (id, status, asOf, createdAt, approvedAt)", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/seniority/lists", headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ id: string; status: string; asOf: string; approvedAt: string | null }> };
    const row = body.data.find((l) => l.id === SENIORITY_LIST_ID);
    expect(row).toBeDefined();
    expect(row?.status).toBe("generated");
    expect(row?.approvedAt).toBeNull();
  });

  it("is HR_ROLES-only, matching generate/approve's own gate", async () => {
    const managerToken = signToken({ sub: "dpc-manager", tid: TENANT, roles: ["manager"], sid: "s-mgr" }, SECRET);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/seniority/lists", headers: { authorization: `Bearer ${managerToken}` } });
    expect(r.statusCode).toBe(403);
  });

  it("never returns another tenant's snapshots", async () => {
    const OTHER_TENANT = "d9c00000-0000-4000-8000-000000000009";
    await withRawTenantGuc(sqlClient, OTHER_TENANT, (tx) => tx`
      INSERT INTO seniority.hrms_seniority_lists (id, tenant_id, as_of, status, entry_count, generated_by)
      VALUES (gen_random_uuid(), ${OTHER_TENANT}, '2026-04-01', 'generated', 0, ${SEED_ACTOR})
    `);
    const r = await app.inject({ method: "GET", url: "/v1/hrms/seniority/lists", headers: { authorization: `Bearer ${hrToken}` } });
    const body = JSON.parse(r.body) as { data: Array<{ id: string }> };
    expect(body.data.every((l) => l.id === SENIORITY_LIST_ID)).toBe(true);
    await withRawTenantGuc(sqlClient, OTHER_TENANT, (tx) => tx`DELETE FROM seniority.hrms_seniority_lists WHERE tenant_id = ${OTHER_TENANT}`);
  });
});
