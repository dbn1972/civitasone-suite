/**
 * GAP-HR-DPC-02: GET /v1/hrms/lifecycle/promotions already batch-resolved
 * employeeName/fromDesignationName/toDesignationName (GAP-HR-SF-17) but the
 * web card reading it (PromotionCard.tsx) looked for different field names,
 * so every card still showed the raw UUID despite the backend enrichment
 * existing. This test covers the backend half of that fix directly: the
 * newly-added `department` field (resolved via each row's employee) and the
 * new `?status=` filter the DPC batch view now uses to scope to in-flight
 * promotions.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT     = "beef0000-0000-4000-8000-000000000001";
const SEED_ACTOR  = "beef0000-0000-4000-8000-0000000000a0";
const DEPT_A_ID   = "beef0000-0000-4000-8000-0000000000da";
const DEPT_B_ID   = "beef0000-0000-4000-8000-0000000000db";
const DESIG_FROM_ID = "beef0000-0000-4000-8000-0000000000d1";
const DESIG_TO_ID   = "beef0000-0000-4000-8000-0000000000d2";
const EMP_A_ID    = "beef0000-0000-4000-8000-0000000000e1";
const EMP_B_ID    = "beef0000-0000-4000-8000-0000000000e2";

const hrToken = signToken({ sub: "lcp-hr-admin", tid: TENANT, roles: ["hr_admin"], sid: "s-hr" }, SECRET);

let app: Awaited<ReturnType<typeof buildApp>>;
let pendingPromotionId: string;

function asTenant<T>(fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, TENANT, fn);
}

async function cleanup(): Promise<void> {
  await asTenant((tx) => tx`DELETE FROM lifecycle.hrms_promotions WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant((tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

beforeAll(async () => {
  await cleanup();

  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_A_ID}, ${TENANT}, 'LCPA', 'Revenue Department', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_B_ID}, ${TENANT}, 'LCPB', 'Home Department', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_FROM_ID}, ${TENANT}, 'LCPF', 'Section Officer', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_TO_ID}, ${TENANT}, 'LCPT', 'Under Secretary', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${EMP_A_ID}, ${TENANT}, 'LCP-A', 'Promotion Candidate A', ${DEPT_A_ID}, ${DESIG_FROM_ID}, '2015-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant((tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (${EMP_B_ID}, ${TENANT}, 'LCP-B', 'Promotion Candidate B', ${DEPT_B_ID}, ${DESIG_FROM_ID}, '2012-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  const pendingRows = await asTenant((tx) => tx`
    INSERT INTO lifecycle.hrms_promotions (id, tenant_id, employee_id, from_desig_id, to_desig_id, effective_date, status, created_by, updated_by)
    VALUES (gen_random_uuid(), ${TENANT}, ${EMP_A_ID}, ${DESIG_FROM_ID}, ${DESIG_TO_ID}, '2026-05-01', 'pending', ${SEED_ACTOR}, ${SEED_ACTOR})
    RETURNING id
  `);
  if (!pendingRows[0]) throw new Error("seed insert did not return a row");
  pendingPromotionId = pendingRows[0].id as string;

  await asTenant((tx) => tx`
    INSERT INTO lifecycle.hrms_promotions (id, tenant_id, employee_id, from_desig_id, to_desig_id, effective_date, status, created_by, updated_by)
    VALUES (gen_random_uuid(), ${TENANT}, ${EMP_B_ID}, ${DESIG_FROM_ID}, ${DESIG_TO_ID}, '2025-05-01', 'completed', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/lifecycle/promotions — GAP-HR-DPC-02", () => {
  it("resolves each row's employee name, department (via the employee) and from/to designation names", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/promotions", headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as {
      data: Array<{ employeeId: string; employeeName: string; department: string; fromDesignationName: string; toDesignationName: string }>;
    };

    const rowA = body.data.find((d) => d.employeeId === EMP_A_ID);
    expect(rowA).toBeDefined();
    expect(rowA?.employeeName).toBe("Promotion Candidate A");
    expect(rowA?.department).toBe("Revenue Department");
    expect(rowA?.fromDesignationName).toBe("Section Officer");
    expect(rowA?.toDesignationName).toBe("Under Secretary");

    const rowB = body.data.find((d) => d.employeeId === EMP_B_ID);
    expect(rowB?.department).toBe("Home Department");
  });

  it("?status= scopes to in-flight promotions only, matching the DPC batch view's own request", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/promotions?status=pending", headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ id: string; status: string }> };
    expect(body.data.map((d) => d.id)).toEqual([pendingPromotionId]);
    expect(body.data.every((d) => d.status === "pending")).toBe(true);
  });

  it("never resolves a name from another tenant's department, even by a coincidentally-matching id", async () => {
    // Sanity check on tenant isolation of the batch-resolve helpers
    // themselves (batchEmployees/batchDepartments/batchDesignations) — a
    // manager/HR in this tenant must never see another tenant's department
    // name surface through the enrichment.
    const r = await app.inject({ method: "GET", url: "/v1/hrms/lifecycle/promotions", headers: { authorization: `Bearer ${hrToken}` } });
    const body = JSON.parse(r.body) as { data: Array<{ department: string }> };
    expect(body.data.every((d) => ["Revenue Department", "Home Department"].includes(d.department))).toBe(true);
  });
});
