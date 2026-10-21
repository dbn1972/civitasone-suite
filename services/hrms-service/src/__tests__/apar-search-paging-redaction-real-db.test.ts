/**
 * HR cluster 10 rescan -- real-DB round trip for:
 *  - GAP-HR-APAR-06: GET /v1/hrms/apar ?q= search, 150-row total / page of 20,
 *    status filter, read-scope and tenant isolation of all of it.
 *  - GAP-HR-APAR-DETAIL-03: the appraisee must not read officer-confidential
 *    content before disclosure through the stage-history rows (payload and
 *    remarks), through the list, or because they also hold an HR role.
 *  - GAP-HR-APAR-DETAIL-05: the detail response carries the grade-band table.
 *
 * Own tenants (a9a5...) so the 150-row fixture cannot disturb the exact
 * counts asserted by apar-list-detail-real-db.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { signToken } from "@civitasone/auth";
import { withRawTenantGuc } from "@civitasone/db";
import { buildApp } from "../app.js";
import { sqlClient } from "../shared/db.js";

const SECRET = process.env.JWT_SECRET;
if (!SECRET) throw new Error("JWT_SECRET must be set by the vitest config");

const TENANT       = "a9a50000-0000-4000-8000-000000000001";
const OTHER_TENANT = "a9a50000-0000-4000-8000-000000000002";
const SEED_ACTOR   = "a9a50000-0000-4000-8000-0000000000a0";
// Department / designation ids are globally unique (primary key is `id`), so each tenant gets its own.
const DEPT_ID      = "a9a50000-0000-4000-8000-0000000000d1";
const DESIG_ID     = "a9a50000-0000-4000-8000-0000000000d2";
const OTHER_DEPT_ID  = "a9a50000-0000-4000-8000-0000000000d3";
const OTHER_DESIG_ID = "a9a50000-0000-4000-8000-0000000000d4";

const APPRAISEE_ACTOR = "a9a50000-0000-4000-8000-0000000000e0";
const APPRAISEE_EMP   = "a9a50000-0000-4000-8000-0000000000e1"; // "Search Appraisee" APR-S1
const PRIYA_EMP       = "a9a50000-0000-4000-8000-0000000000e2"; // "Priya Nair"       APR-S2
const ARJUN_EMP       = "a9a50000-0000-4000-8000-0000000000e3"; // "Arjun Rao"        APR-S3
const RO_EMP          = "a9a50000-0000-4000-8000-0000000000e4";
const RVO_EMP         = "a9a50000-0000-4000-8000-0000000000e5";
const AA_EMP          = "a9a50000-0000-4000-8000-0000000000e6";
const HR_APPRAISEE_ACTOR = "a9a50000-0000-4000-8000-0000000000f0"; // an hr_admin who is ALSO an appraisee
const HR_APPRAISEE_EMP   = "a9a50000-0000-4000-8000-0000000000f1";
const OTHER_EMP       = "a9a50000-0000-4000-8000-0000000000c1";

const hrToken          = signToken({ sub: SEED_ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-hr" }, SECRET);
const appraiseeToken   = signToken({ sub: APPRAISEE_ACTOR, tid: TENANT, roles: ["employee"], sid: "s-emp" }, SECRET);
const hrAppraiseeToken = signToken({ sub: HR_APPRAISEE_ACTOR, tid: TENANT, roles: ["hr_admin"], sid: "s-hr2" }, SECRET);

let app: Awaited<ReturnType<typeof buildApp>>;

function asTenant<T>(tenantId: string, fn: (tx: typeof sqlClient) => Promise<T>): Promise<T> {
  return withRawTenantGuc(sqlClient, tenantId, fn);
}

async function cleanup(): Promise<void> {
  for (const tenantId of [TENANT, OTHER_TENANT]) {
    await asTenant(tenantId, (tx) => tx`DELETE FROM audit.hr_action_log WHERE tenant_id = ${tenantId}`);
    // appraisal.hrms_apar_stage_history is append-only at the DB level
    // (trg_apar_history_no_mutation, migration 0119) -- the service role cannot
    // DELETE from it. Its rows are keyed by random appraisal ids, so leftovers
    // from an earlier run on a persistent database are inert for this one.
    await asTenant(tenantId, (tx) => tx`DELETE FROM appraisal.hrms_apar_scores WHERE tenant_id = ${tenantId}`);
    await asTenant(tenantId, (tx) => tx`DELETE FROM appraisal.hrms_appraisals WHERE tenant_id = ${tenantId}`);
    await asTenant(tenantId, (tx) => tx`DELETE FROM employee.hrms_employees WHERE tenant_id = ${tenantId}`);
    await asTenant(tenantId, (tx) => tx`DELETE FROM employee.hrms_designations WHERE tenant_id = ${tenantId}`);
    await asTenant(tenantId, (tx) => tx`DELETE FROM employee.hrms_departments WHERE tenant_id = ${tenantId}`);
  }
}

async function seedEmployee(tenantId: string, id: string, no: string, name: string, userRef: string | null) {
  const deptId = tenantId === TENANT ? DEPT_ID : OTHER_DEPT_ID;
  const desigId = tenantId === TENANT ? DESIG_ID : OTHER_DESIG_ID;
  await asTenant(tenantId, (tx) => tx`
    INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
    VALUES (${id}, ${tenantId}, ${no}, ${name}, ${deptId}, ${desigId}, '2018-01-01', ${userRef}, ${SEED_ACTOR}, ${SEED_ACTOR})
  `);
}

async function seedAppraisal(opts: {
  employeeId: string; period: string; status: string; penPicture?: string; reviewingRemarks?: string;
  acceptingRemarks?: string; grade?: string; band?: string;
}): Promise<string> {
  const rows = await asTenant(TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_appraisals
      (tenant_id, employee_id, appraisal_period, status, reporting_officer_id, reviewing_officer_id, accepting_authority_id,
       reporting_pen_picture, reviewing_remarks, accepting_remarks, overall_grade, overall_band, created_by, updated_by)
    VALUES (${TENANT}, ${opts.employeeId}, ${opts.period}, ${opts.status}, ${RO_EMP}, ${RVO_EMP}, ${AA_EMP},
            ${opts.penPicture ?? null}, ${opts.reviewingRemarks ?? null}, ${opts.acceptingRemarks ?? null},
            ${opts.grade ?? null}, ${opts.band ?? null}, ${SEED_ACTOR}, ${SEED_ACTOR})
    RETURNING id
  `);
  if (!rows[0]) throw new Error("seed insert did not return a row");
  return rows[0].id as string;
}

async function seedHistory(appraisalId: string, rows: Array<{
  from: string | null; to: string; remarks: string | null; payload: Record<string, unknown>; minutesAgo: number;
}>) {
  for (const h of rows) {
    await asTenant(TENANT, (tx) => tx`
      INSERT INTO appraisal.hrms_apar_stage_history
        (tenant_id, appraisal_id, from_stage, to_stage, actor_id, actor_role, override, remarks, payload, created_at)
      VALUES (${TENANT}, ${appraisalId}, ${h.from}, ${h.to}, ${SEED_ACTOR}, 'officer', false, ${h.remarks},
              ${JSON.stringify(h.payload)}::jsonb, now() - (${h.minutesAgo} * interval '1 minute'))
    `);
  }
}

const PEN = "Confidential pen picture text";
const SCORE_REMARK = "Confidential score remark";
const RVO_REMARK = "Reviewer secret remark";
const OWN_WORDS = "My own self appraisal words";

let reportingStageId: string;     // reviewing_officer: pen picture recorded, awaiting reviewing officer
let acceptingStageId: string;     // accepting_authority: reviewing remark recorded too
let disclosedId: string;          // already disclosed
let hrAppraiseeRecordId: string;  // the hr_admin's own pre-disclosure record

beforeAll(async () => {
  await cleanup();
  for (const [tenantId, deptId, desigId] of [[TENANT, DEPT_ID, DESIG_ID], [OTHER_TENANT, OTHER_DEPT_ID, OTHER_DESIG_ID]] as const) {
    await asTenant(tenantId, (tx) => tx`
      INSERT INTO employee.hrms_departments (id, tenant_id, code, name, created_by, updated_by)
      VALUES (${deptId}, ${tenantId}, 'APSD', 'APAR Search Dept', ${SEED_ACTOR}, ${SEED_ACTOR})`);
    await asTenant(tenantId, (tx) => tx`
      INSERT INTO employee.hrms_designations (id, tenant_id, code, name, created_by, updated_by)
      VALUES (${desigId}, ${tenantId}, 'APSG', 'APAR Search Designation', ${SEED_ACTOR}, ${SEED_ACTOR})`);
  }
  await seedEmployee(TENANT, APPRAISEE_EMP, "APR-S1", "Search Appraisee", APPRAISEE_ACTOR);
  await seedEmployee(TENANT, PRIYA_EMP, "APR-S2", "Priya Nair", null);
  await seedEmployee(TENANT, ARJUN_EMP, "APR-S3", "Arjun Rao", null);
  await seedEmployee(TENANT, RO_EMP, "APR-O1", "Reporting Officer One", null);
  await seedEmployee(TENANT, RVO_EMP, "APR-O2", "Reviewing Officer One", null);
  await seedEmployee(TENANT, AA_EMP, "APR-O3", "Accepting Authority One", null);
  await seedEmployee(TENANT, HR_APPRAISEE_EMP, "APR-H1", "Hr Who Is Appraised", HR_APPRAISEE_ACTOR);
  await seedEmployee(OTHER_TENANT, OTHER_EMP, "APR-X1", "Priya Other Tenant", null);

  // ---- 150-row fixture for APAR-06 (periods P0001..P0150, 5 chars) ----
  // 1..5 -> Search Appraisee, 6..125 -> Priya Nair (6..85 self_pending, 86..125 finalised), 126..150 -> Arjun Rao
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_appraisals
      (tenant_id, employee_id, appraisal_period, status, reporting_officer_id, reviewing_officer_id, accepting_authority_id, created_by, updated_by, updated_at)
    SELECT ${TENANT},
           CASE WHEN g <= 5 THEN ${APPRAISEE_EMP}::uuid WHEN g <= 125 THEN ${PRIYA_EMP}::uuid ELSE ${ARJUN_EMP}::uuid END,
           'P' || lpad(g::text, 4, '0'),
           CASE WHEN g BETWEEN 86 AND 125 THEN 'finalised' ELSE 'self_pending' END,
           ${RO_EMP}, ${RVO_EMP}, ${AA_EMP}, ${SEED_ACTOR}, ${SEED_ACTOR}, now() - (g * interval '1 minute')
    FROM generate_series(1, 150) AS g
  `);
  // A different tenant's rows, matching the same search terms, must never surface.
  await asTenant(OTHER_TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_appraisals (tenant_id, employee_id, appraisal_period, status, created_by, updated_by)
    SELECT ${OTHER_TENANT}, ${OTHER_EMP}, 'X' || lpad(g::text, 4, '0'), 'self_pending', ${SEED_ACTOR}, ${SEED_ACTOR}
    FROM generate_series(1, 3) AS g
  `);

  // ---- redaction fixtures ----
  reportingStageId = await seedAppraisal({ employeeId: APPRAISEE_EMP, period: "R-RO", status: "reviewing_officer", penPicture: PEN });
  await asTenant(TENANT, (tx) => tx`
    INSERT INTO appraisal.hrms_apar_scores (tenant_id, appraisal_id, attribute, weight, score, remarks, scored_by, created_by, updated_by)
    VALUES (${TENANT}, ${reportingStageId}, 'Quality', 100, 9, ${SCORE_REMARK}, ${RO_EMP}, ${SEED_ACTOR}, ${SEED_ACTOR})`);
  await seedHistory(reportingStageId, [
    { from: null, to: "self_pending", remarks: "APAR initiated", payload: {}, minutesAgo: 30 },
    { from: "self_pending", to: "reporting_officer", remarks: "self-appraisal submitted", payload: { selfAppraisal: OWN_WORDS }, minutesAgo: 20 },
    { from: "reporting_officer", to: "reviewing_officer", remarks: "scores + pen-picture recorded",
      payload: { penPicture: PEN, scores: [{ attribute: "Quality", score: 9, remarks: SCORE_REMARK }] }, minutesAgo: 10 },
  ]);

  acceptingStageId = await seedAppraisal({
    employeeId: APPRAISEE_EMP, period: "R-AA", status: "accepting_authority", penPicture: PEN, reviewingRemarks: RVO_REMARK,
  });
  await seedHistory(acceptingStageId, [
    { from: "self_pending", to: "reporting_officer", remarks: "self-appraisal submitted", payload: { selfAppraisal: OWN_WORDS }, minutesAgo: 30 },
    { from: "reporting_officer", to: "reviewing_officer", remarks: "scores + pen-picture recorded", payload: { penPicture: PEN, scores: [] }, minutesAgo: 20 },
    { from: "reviewing_officer", to: "accepting_authority", remarks: RVO_REMARK,
      payload: { decision: "vary", variations: [{ attribute: "Quality", score: 7 }] }, minutesAgo: 10 },
  ]);

  disclosedId = await seedAppraisal({
    employeeId: APPRAISEE_EMP, period: "R-DISC", status: "disclosed", penPicture: PEN, reviewingRemarks: RVO_REMARK,
    acceptingRemarks: "Accepting remark", grade: "7.20", band: "Very Good",
  });
  await seedHistory(disclosedId, [
    { from: "reviewing_officer", to: "accepting_authority", remarks: RVO_REMARK, payload: { decision: "concur", variations: [] }, minutesAgo: 20 },
    { from: "accepting_authority", to: "disclosed", remarks: "Accepting remark", payload: { computed: { overallGrade: 7.2, band: "Very Good" } }, minutesAgo: 10 },
  ]);

  hrAppraiseeRecordId = await seedAppraisal({ employeeId: HR_APPRAISEE_EMP, period: "R-HR", status: "reviewing_officer", penPicture: PEN });
  await seedHistory(hrAppraiseeRecordId, [
    { from: "reporting_officer", to: "reviewing_officer", remarks: "scores + pen-picture recorded", payload: { penPicture: PEN, scores: [] }, minutesAgo: 10 },
  ]);

  app = await buildApp();
});

afterAll(async () => {
  await cleanup();
  await app?.close();
  await sqlClient.end();
});

type ListBody = { data: Array<Record<string, unknown>>; total: number; hasMore: boolean; counts: Record<string, number> };
const get = (url: string, token: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

// 150 fixture rows + the 4 redaction fixtures (R-RO, R-AA, R-DISC for the appraisee; R-HR for the HR appraisee).
const FIXTURE_ROWS = 150;
const REDACTION_ROWS = 4;

describe("GET /v1/hrms/apar -- GAP-HR-APAR-06 total / paging / q / status / scope", () => {
  it("reports the true total and pages by limit/offset (page of 20, last partial page)", async () => {
    const first = JSON.parse((await get("/v1/hrms/apar?limit=20", hrToken)).body) as ListBody;
    expect(first.total).toBe(FIXTURE_ROWS + REDACTION_ROWS);
    expect(first.data).toHaveLength(20);
    expect(first.hasMore).toBe(true);

    const last = JSON.parse((await get(`/v1/hrms/apar?limit=20&offset=${Math.floor((FIXTURE_ROWS + REDACTION_ROWS - 1) / 20) * 20}`, hrToken)).body) as ListBody;
    expect(last.data).toHaveLength((FIXTURE_ROWS + REDACTION_ROWS) % 20 || 20);
    expect(last.hasMore).toBe(false);

    // pages are disjoint
    const second = JSON.parse((await get("/v1/hrms/apar?limit=20&offset=20", hrToken)).body) as ListBody;
    const firstIds = new Set(first.data.map((r) => r.id));
    expect(second.data.some((r) => firstIds.has(r.id))).toBe(false);
  });

  it("?status= filters within the paged result and still reports its own total", async () => {
    const body = JSON.parse((await get("/v1/hrms/apar?status=finalised&limit=20", hrToken)).body) as ListBody;
    expect(body.total).toBe(40);
    expect(body.data).toHaveLength(20);
    expect(body.data.every((r) => r.status === "finalised")).toBe(true);
    expect(body.hasMore).toBe(true);
  });

  it("?q= matches the appraisee name case-insensitively", async () => {
    const body = JSON.parse((await get("/v1/hrms/apar?q=pRiYa&limit=500", hrToken)).body) as ListBody;
    expect(body.total).toBe(120);
    expect(body.data.every((r) => r.employeeName === "Priya Nair")).toBe(true);
  });

  it("?q= matches the employee number too, and combines with ?status=", async () => {
    const byNo = JSON.parse((await get("/v1/hrms/apar?q=APR-S3&limit=500", hrToken)).body) as ListBody;
    expect(byNo.total).toBe(25);
    const combined = JSON.parse((await get("/v1/hrms/apar?q=priya&status=finalised&limit=500", hrToken)).body) as ListBody;
    expect(combined.total).toBe(40);
  });

  it("treats LIKE wildcards in ?q= literally, so '%' or '_' does not match everyone", async () => {
    for (const q of ["%25", "_", "a%25e"]) {
      const body = JSON.parse((await get(`/v1/hrms/apar?q=${q}`, hrToken)).body) as ListBody;
      expect(body.total).toBe(0);
    }
  });

  it("an empty ?q= is rejected by validation rather than silently ignored", async () => {
    const r = await get("/v1/hrms/apar?q=", hrToken);
    expect(r.statusCode).toBe(400);
  });

  it("an employee's search stays inside their own read scope: ?q= for someone else's name finds nothing", async () => {
    const own = JSON.parse((await get("/v1/hrms/apar?limit=500", appraiseeToken)).body) as ListBody;
    expect(own.data.every((r) => r.employeeId === APPRAISEE_EMP)).toBe(true);
    const other = JSON.parse((await get("/v1/hrms/apar?q=priya", appraiseeToken)).body) as ListBody;
    expect(other.total).toBe(0);
    expect(other.data).toHaveLength(0);
    const mine = JSON.parse((await get("/v1/hrms/apar?q=search%20appraisee", appraiseeToken)).body) as ListBody;
    expect(mine.total).toBe(own.total);
  });

  it("never returns another tenant's rows for the same search term", async () => {
    const body = JSON.parse((await get("/v1/hrms/apar?q=other%20tenant&limit=500", hrToken)).body) as ListBody;
    expect(body.total).toBe(0);
  });
});

describe("GET /v1/hrms/apar -- GAP-HR-APAR-DETAIL-03 list redaction of the viewer's own pre-disclosure record", () => {
  it("the appraisee's own list rows carry no pen picture / remarks / grade before disclosure", async () => {
    const body = JSON.parse((await get("/v1/hrms/apar?limit=500", appraiseeToken)).body) as ListBody;
    const row = body.data.find((r) => r.id === reportingStageId);
    expect(row).toBeDefined();
    expect(row?.reportingPenPicture).toBeNull();
    const aa = body.data.find((r) => r.id === acceptingStageId);
    expect(aa?.reviewingRemarks).toBeNull();
    // Only the not-yet-disclosed rows are checked: the disclosed one legitimately carries the text.
    const preDisclosure = JSON.stringify(body.data.filter((r) => r.id === reportingStageId || r.id === acceptingStageId));
    expect(preDisclosure).not.toContain(PEN);
    expect(preDisclosure).not.toContain(RVO_REMARK);
  });

  it("the same record is intact for HR, and a disclosed record is intact for its appraisee", async () => {
    const hr = JSON.parse((await get("/v1/hrms/apar?limit=500", hrToken)).body) as ListBody;
    expect(hr.data.find((r) => r.id === reportingStageId)?.reportingPenPicture).toBe(PEN);
    const own = JSON.parse((await get("/v1/hrms/apar?limit=500", appraiseeToken)).body) as ListBody;
    expect(own.data.find((r) => r.id === disclosedId)?.reportingPenPicture).toBe(PEN);
  });
});

type DetailBody = {
  appraisal: Record<string, unknown>;
  scores: Array<{ remarks: string | null }>;
  history: Array<{ fromStage: string | null; toStage: string; remarks: string | null; payload: Record<string, unknown> }>;
  gradeBands: Array<{ band: string; min: number | null }>;
};

describe("GET /v1/hrms/apar/:id -- GAP-HR-APAR-DETAIL-03 stage-history redaction", () => {
  it("strips officer remarks and payload from the appraisee's history before disclosure, keeping stage/actor/time rows", async () => {
    const r = await get(`/v1/hrms/apar/${reportingStageId}`, appraiseeToken);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as DetailBody;
    expect(body.appraisal.reportingPenPicture).toBeNull();
    expect(body.history).toHaveLength(3);
    const officerRow = body.history.find((h) => h.fromStage === "reporting_officer");
    expect(officerRow?.toStage).toBe("reviewing_officer");
    expect(officerRow?.remarks).toBeNull();
    expect(officerRow?.payload).toEqual({});
    // the appraisee's OWN submission is theirs to see
    const own = body.history.find((h) => h.fromStage === "self_pending");
    expect(own?.payload).toEqual({ selfAppraisal: OWN_WORDS });
    expect(r.body).not.toContain(PEN);
    expect(r.body).not.toContain(SCORE_REMARK);
  });

  it("hides the Reviewing Officer's remark and concur/vary decision from the appraisee's history at the accepting stage", async () => {
    const r = await get(`/v1/hrms/apar/${acceptingStageId}`, appraiseeToken);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as DetailBody;
    const rvRow = body.history.find((h) => h.fromStage === "reviewing_officer");
    expect(rvRow?.remarks).toBeNull();
    expect(rvRow?.payload).toEqual({});
    expect(r.body).not.toContain(RVO_REMARK);
    expect(r.body).not.toContain("vary");
  });

  it("shows HR the full history of the same records", async () => {
    const r = await get(`/v1/hrms/apar/${acceptingStageId}`, hrToken);
    const body = JSON.parse(r.body) as DetailBody;
    const rvRow = body.history.find((h) => h.fromStage === "reviewing_officer");
    expect(rvRow?.remarks).toBe(RVO_REMARK);
    expect(rvRow?.payload).toMatchObject({ decision: "vary", variations: [{ attribute: "Quality", score: 7 }] });
    const ro = JSON.parse((await get(`/v1/hrms/apar/${reportingStageId}`, hrToken)).body) as DetailBody;
    expect(ro.history.find((h) => h.fromStage === "reporting_officer")?.payload).toMatchObject({ penPicture: PEN });
  });

  it("an hr_admin who is the appraisee is redacted on their OWN pre-disclosure record (identity, not role)", async () => {
    const r = await get(`/v1/hrms/apar/${hrAppraiseeRecordId}`, hrAppraiseeToken);
    expect(r.statusCode).toBe(200);
    const body = JSON.parse(r.body) as DetailBody;
    expect(body.appraisal.reportingPenPicture).toBeNull();
    expect(body.history[0]?.payload).toEqual({});
    expect(r.body).not.toContain(PEN);
    // ...but sees a colleague's record in full, as an HR administrator should
    const other = JSON.parse((await get(`/v1/hrms/apar/${reportingStageId}`, hrAppraiseeToken)).body) as DetailBody;
    expect(other.appraisal.reportingPenPicture).toBe(PEN);
  });

  it("gives the appraisee the full history once the record is disclosed", async () => {
    const body = JSON.parse((await get(`/v1/hrms/apar/${disclosedId}`, appraiseeToken)).body) as DetailBody;
    const rvRow = body.history.find((h) => h.fromStage === "reviewing_officer");
    expect(rvRow?.remarks).toBe(RVO_REMARK);
    expect(rvRow?.payload).toMatchObject({ decision: "concur" });
  });
});

describe("GET /v1/hrms/apar/:id -- GAP-HR-APAR-DETAIL-05 grade band table", () => {
  it("returns the engine's band table so the page prints the scale from the API", async () => {
    const body = JSON.parse((await get(`/v1/hrms/apar/${disclosedId}`, hrToken)).body) as DetailBody;
    expect(body.gradeBands).toEqual([
      { band: "Outstanding", min: 9 },
      { band: "Very Good", min: 7 },
      { band: "Good", min: 5 },
      { band: "Average", min: 4 },
      { band: "Below Average", min: null },
    ]);
  });
});
