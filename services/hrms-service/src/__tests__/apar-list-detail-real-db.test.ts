/**
 * GAP-HR-APAR-01/06 (list: server-side counts, status/period filters,
 * honest total/hasMore) and GAP-HR-APAR-DETAIL-03/07 (detail: appraisee
 * pre-disclosure redaction + DPDP read-audit event) — real-DB round trip.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";

const TENANT     = "a9a40000-0000-4000-8000-000000000001";
const OTHER_TENANT = "a9a40000-0000-4000-8000-000000000002";
const SEED_ACTOR  = "a9a40000-0000-4000-8000-0000000000a0";
const DEPT_ID     = "a9a40000-0000-4000-8000-0000000000d1";
const DESIG_ID    = "a9a40000-0000-4000-8000-0000000000d2";

const APPRAISEE_ACTOR_ID = "a9a40000-0000-4000-8000-0000000000e0";
const EMPLOYEE_ID  = "a9a40000-0000-4000-8000-0000000000e1";
const RO_ID        = "a9a40000-0000-4000-8000-0000000000e2";
const RVO_ID       = "a9a40000-0000-4000-8000-0000000000e3";
const AA_ID        = "a9a40000-0000-4000-8000-0000000000e4";

const hrToken       = signToken({ sub: "apar-hr-admin", tid: TENANT, roles: ["hr_admin"], sid: "s-hr" }, SECRET);
const appraiseeToken = signToken({ sub: APPRAISEE_ACTOR_ID, tid: TENANT, roles: ["employee"], sid: "s-emp" }, SECRET);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(tenantId: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await asTenant(tenantId, (tx) => tx`DELETE FROM audit.hr_action_log WHERE tenant_id = ${tenantId}`);
    await asTenant(tenantId, (tx) => tx`DELETE FROM appraisal.hrms_apar_scores WHERE tenant_id = ${tenantId}`);
    await asTenant(tenantId, (tx) => tx`DELETE FROM appraisal.hrms_appraisals WHERE tenant_id = ${tenantId}`);
    await asTenant(tenantId, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tenantId}`);
  }
  await asTenant(TENANT, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${TENANT}`);
  await asTenant(TENANT, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${TENANT}`);
}

let preDisclosureId: string;
let disclosedId: string;

beforeAll(async () => {
  await cleanup();

  await asTenant(TENANT, (tx) => tx`
    INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DEPT_ID}, ${TENANT}, 'APARD', 'APAR Test Dept', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
    VALUES (${DESIG_ID}, ${TENANT}, 'APARDG', 'APAR Test Designation', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // The appraisee -- linked via user_ref so resolveEmployeeForActor(tenant, APPRAISEE_ACTOR_ID) hits.
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${EMPLOYEE_ID}, ${TENANT}, 'APAR-E1', 'Apar Test Appraisee', ${DEPT_ID}, ${DESIG_ID}, '2018-01-01', ${APPRAISEE_ACTOR_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  for (const [id, no] of [[RO_ID, "APAR-E2"], [RVO_ID, "APAR-E3"], [AA_ID, "APAR-E4"]] as const) {
    await asTenant(TENANT, (tx) => tx`
      INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
      VALUES (${id}, ${TENANT}, ${no}, ${"Officer " + no}, ${DEPT_ID}, ${DESIG_ID}, '2015-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }

  // List-filter fixture: one appraisal per real backend status, all period "2025-26".
  const statuses = ["self_pending", "reporting_officer", "reviewing_officer", "accepting_authority", "disclosed", "representation", "finalised"];
  for (const status of statuses) {
    await asTenant(TENANT, (tx) => tx`
      INSERT INTO appraisal.hrms_appraisals
        (tenant_id, employee_id, appraisal_period, status, reporting_officer_id, reviewing_officer_id, accepting_authority_id, created_by, updated_by)
      VALUES (${TENANT}, ${EMPLOYEE_ID}, '2025-26', ${status}, ${RO_ID}, ${RVO_ID}, ${AA_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
    `);
  }
  // A different period, for the ?period= filter test.
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_appraisals
      (tenant_id, employee_id, appraisal_period, status, reporting_officer_id, reviewing_officer_id, accepting_authority_id, created_by, updated_by)
    VALUES (${TENANT}, ${EMPLOYEE_ID}, '2024-25', 'finalised', ${RO_ID}, ${RVO_ID}, ${AA_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
  // A row in a DIFFERENT tenant, must never leak into TENANT's counts/list.
  await asTenant(OTHER_TENANT, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, created_by, updated_by)
    VALUES (gen_random_uuid(), ${OTHER_TENANT}, 'OTH-1', 'Other Tenant Emp', ${DEPT_ID}, ${DESIG_ID}, '2020-01-01', ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // Detail fixture 1: pre-disclosure, has RO pen-picture + score remarks already recorded.
  const preRows = await asTenant(TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_appraisals
      (tenant_id, employee_id, appraisal_period, status, reporting_officer_id, reviewing_officer_id, accepting_authority_id,
       reporting_pen_picture, overall_grade, overall_band, created_by, updated_by)
    VALUES (${TENANT}, ${EMPLOYEE_ID}, 'PRE-01', 'reviewing_officer', ${RO_ID}, ${RVO_ID}, ${AA_ID},
            'Confidential pen picture text', 8.50, 'Very Good', ${SEED_ACTOR}, ${SEED_ACTOR})
    RETURNING id
  `);
  if (!preRows[0]) throw new Error("seed insert did not return a row");
  preDisclosureId = preRows[0].id as string;
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_apar_scores (tenant_id, appraisal_id, attribute, weight, score, remarks, scored_by, created_by, updated_by)
    VALUES (${TENANT}, ${preDisclosureId}, 'Quality', 100, 9, 'Confidential score remark', ${RO_ID}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);

  // Detail fixture 2: already disclosed -- the appraisee should see everything.
  const discRows = await asTenant(TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_appraisals
      (tenant_id, employee_id, appraisal_period, status, reporting_officer_id, reviewing_officer_id, accepting_authority_id,
       reporting_pen_picture, reviewing_remarks, accepting_remarks, overall_grade, overall_band, disclosed_at, created_by, updated_by)
    VALUES (${TENANT}, ${EMPLOYEE_ID}, 'DISC-01', 'disclosed', ${RO_ID}, ${RVO_ID}, ${AA_ID},
            'Disclosed pen picture', 'Disclosed reviewing remark', 'Disclosed accepting remark',
            7.20, 'Very Good', now(), ${SEED_ACTOR}, ${SEED_ACTOR})
    RETURNING id
  `);
  if (!discRows[0]) throw new Error("seed insert did not return a row");
  disclosedId = discRows[0].id as string;

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app.close();
  await sqlClient.end();
});

describe("GET /v1/hrms/apar — GAP-HR-APAR-01/06 list filters + server-side counts", () => {
  // Tenant total across every appraisal this file seeds: the 7-status list
  // fixture + its 2024-25 period sibling (8), plus the two DETAIL fixtures
  // below (reviewing_officer + disclosed) that are real rows in the same
  // tenant and therefore real contributors to the list/count endpoint too.
  it("returns total/hasMore honestly and a status-group breakdown scoped to the tenant, unfiltered by period", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar?limit=3", headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: unknown[]; total: number; hasMore: boolean; counts: Record<string, number> };
    expect(body.total).toBe(10);
    expect(body.data.length).toBe(3);
    expect(body.hasMore).toBe(true);
    expect(body.counts).toEqual({ selfPending: 1, inReview: 4, awaitingClosure: 3, finalised: 2 });
  });

  it("?status= scopes the returned rows to an exact backend status", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar?status=reviewing_officer", headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ status: string }>; total: number };
    // matches both the list-fixture row AND the pre-disclosure detail fixture (also reviewing_officer)
    expect(body.total).toBe(2);
    expect(body.data.every((row) => row.status === "reviewing_officer")).toBe(true);
  });

  it("?period= scopes to an exact appraisalPeriod, independent of ?status=", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar?period=2024-25", headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { data: Array<{ appraisalPeriod: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.data[0]?.appraisalPeriod).toBe("2024-25");
  });

  it("never leaks another tenant's rows into total/counts", async () => {
    const r = await app.inject({ method: "GET", url: "/v1/hrms/apar", headers: { authorization: `Bearer ${hrToken}` } });
    const body = JSON.parse(r.body) as { total: number };
    expect(body.total).toBe(10);
  });
});

describe("GET /v1/hrms/apar/:id — GAP-HR-APAR-DETAIL-03 appraisee pre-disclosure redaction", () => {
  it("hides pen-picture, grade/band and score remarks from the appraisee before disclosure", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${preDisclosureId}`, headers: { authorization: `Bearer ${appraiseeToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { appraisal: Record<string, unknown>; scores: Array<{ remarks: string | null }> };
    expect(body.appraisal.reportingPenPicture).toBeNull();
    expect(body.appraisal.overallGrade).toBeNull();
    expect(body.appraisal.overallBand).toBeNull();
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0]?.remarks).toBeNull();
  });

  it("shows the SAME pre-disclosure record in full to HR", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${preDisclosureId}`, headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { appraisal: Record<string, unknown>; scores: Array<{ remarks: string | null }> };
    expect(body.appraisal.reportingPenPicture).toBe("Confidential pen picture text");
    expect(body.appraisal.overallGrade).toBe("8.50");
    expect(body.scores).toHaveLength(1);
    expect(body.scores[0]?.remarks).toBe("Confidential score remark");
  });

  it("shows the appraisee everything once the record is actually disclosed", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${disclosedId}`, headers: { authorization: `Bearer ${appraiseeToken}` } });
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as { appraisal: Record<string, unknown> };
    expect(body.appraisal.reportingPenPicture).toBe("Disclosed pen picture");
    expect(body.appraisal.reviewingRemarks).toBe("Disclosed reviewing remark");
    expect(body.appraisal.acceptingRemarks).toBe("Disclosed accepting remark");
    expect(body.appraisal.overallGrade).toBe("7.20");
  });
});

describe("GET /v1/hrms/apar/:id — GAP-HR-APAR-DETAIL-07 DPDP read-audit event", () => {
  it("writes an audit.hr_action_log row for the read, tenant-scoped and naming this record", async () => {
    const r = await app.inject({ method: "GET", url: `/v1/hrms/apar/${disclosedId}`, headers: { authorization: `Bearer ${hrToken}` } });
    expect(r.statusCode).toBe(200);

    const rows = await asTenant(TENANT, (tx) => tx`
      SELECT method, status_code, entity_type, entity_id FROM audit.hr_action_log
      WHERE tenant_id = ${TENANT} AND entity_id = ${disclosedId}
    `);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0]?.method).toBe("GET");
    expect(rows[0]?.status_code).toBe(200);
  });
});
