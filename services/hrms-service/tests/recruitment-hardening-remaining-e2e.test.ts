/**
 * Recruitment hardening, wave 2 — real-Postgres regression suite for the
 * remaining HIGH/MEDIUM findings from the same audit that
 * recruitment-hardening-e2e.test.ts closed the 3 CRITICAL bugs from (PR #1542):
 *
 *   HIGH   — interview double-booking was entirely unchecked (no overlap
 *            query against existing interviews for the same interviewer).
 *   HIGH   — a screening decision never updated hrms_applications.stage, so
 *            the frontend's optimistic stage update reverted on reload.
 *   HIGH   — zero department-scoped authorization anywhere in the module: a
 *            manager/hiring_manager-role caller could view/edit ANY other
 *            department's requisitions/interviews.
 *   MEDIUM — talent pool showed every application ever submitted, unfiltered
 *            by stage.
 *   MEDIUM — JD-template linkage (payRange/selectionProcess/
 *            requiredDocuments/eligibility/qualification, and templateId
 *            itself) silently dropped most fields on job-opening creation.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { signToken } from "@civitasone/auth";
import postgres from "postgres";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";
import { queue } from "../src/shared/infra.js";
import type { MemoryQueue } from "@civitasone/queue";
import { registerRecruitmentConsumers } from "../src/modules/recruitment/consumer.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);
async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001"; // core-seed's fixed demo tenant
const HR = "aaaaaaaa-e2e2-4000-8000-000000000001";
// From tests/fixtures/core-seed.ts — guaranteed to exist once seeded.
const DEPT_FIN = "eeeeeeee-0001-0000-0000-000000000001"; // Finance
const DEPT_PWD = "eeeeeeee-0001-0000-0000-000000000002"; // Public Works
const DESIG = "eeeeeeee-0001-0000-0000-000000000003"; // IAS Officer

// Dedicated department-scoped manager employees for THIS suite (own fixed
// ids — never touches core-seed's own EMP001/EMP002 rows). Actor ids must be
// valid UUIDs: ctx.actorId flows straight into uuid-typed createdBy columns
// on every write these callers make (unlike manager-employee-read-scope-
// real-db.test.ts's non-UUID subs, which only ever issued GETs).
const FIN_MGR_EMP = "eeeeeeee-0001-0000-0000-0000000000f1";
const PWD_MGR_EMP = "eeeeeeee-0001-0000-0000-0000000000f2";
const FIN_MGR_SUB = "aaaaaaaa-e2e2-4000-8000-0000000000f1";
const PWD_MGR_SUB = "aaaaaaaa-e2e2-4000-8000-0000000000f2";
const UNLINKED_MGR_SUB = "aaaaaaaa-e2e2-4000-8000-0000000000f3"; // no hrms_employees row at all

const CT = { "content-type": "application/json" };
const auth = (roles: string[] = ["hr_admin"], sub: string = HR) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}` });
const uniq = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

let app: FastifyInstance;
let db: postgres.Sql;

/** hrms-service tables are FORCE RLS — every read/write needs app.tenant_id set (see core-seed.ts). */
async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT}', true)`);
    return fn(tx);
  });
}

beforeAll(async () => {
  await seedHrmsCoreFixtures();
  db = postgres(process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms", { max: 5 });

  await asTenant(async (tx) => {
    await tx`DELETE FROM employee.hrms_employees WHERE id IN (${FIN_MGR_EMP}, ${PWD_MGR_EMP})`;
    await tx`
      INSERT INTO employee.hrms_employees
        (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
      VALUES
        (${FIN_MGR_EMP}, ${TENANT}, 'MGR-FIN-RE2E', 'Finance Manager (remaining-e2e)', ${DEPT_FIN}, ${DESIG}, '2020-01-01', ${FIN_MGR_SUB}, ${HR}, ${HR}),
        (${PWD_MGR_EMP}, ${TENANT}, 'MGR-PWD-RE2E', 'PWD Manager (remaining-e2e)',     ${DEPT_PWD}, ${DESIG}, '2020-01-01', ${PWD_MGR_SUB}, ${HR}, ${HR})
    `;
  });

  app = await buildApp();
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM employee.hrms_employees WHERE id IN (${FIN_MGR_EMP}, ${PWD_MGR_EMP})`);
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

async function createJobOpening(departmentId: string, vacancies = 3): Promise<string> {
  const r = await app.inject({
    method: "POST", url: "/v1/hrms/job-openings", headers: { ...auth(), ...CT },
    payload: { refNo: uniq("REM"), title: "Remaining-Hardening Test Role", departmentId, vacancies },
  });
  expect(r.statusCode).toBe(202);
  const id = r.json().id as string;
  await drain();
  return id;
}

async function applyAndGetId(jobOpeningId: string, email: string): Promise<string> {
  const r = await app.inject({
    method: "POST", url: "/v1/hrms/applications", headers: { ...auth(), ...CT },
    payload: { jobOpeningId, applicantName: "Remaining Hardening Candidate", email },
  });
  expect(r.statusCode).toBe(202);
  const id = r.json().id as string;
  await drain();
  return id;
}

async function getApplicationRow(id: string) {
  const rows = await asTenant((tx) => tx`select stage, screening_decision from recruitment.hrms_applications where id = ${id}`);
  return rows[0] as { stage: string; screening_decision: string } | undefined;
}

async function screeningDecision(applicationId: string, payload: Record<string, unknown>): Promise<{ statusCode: number }> {
  const r = await app.inject({
    method: "POST", url: `/v1/hrms/applications/${applicationId}/screening-decision`, headers: { ...auth(), ...CT },
    payload,
  });
  await drain();
  return { statusCode: r.statusCode };
}

// ═══════════════════════════════════════════════════════════════════════
describe("HIGH — interview double-booking", () => {
  it("rejects a second interview for the same interviewer with an overlapping time window (409)", async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const appA = await applyAndGetId(jobId, `${uniq("ivA")}@example.gov.in`);
    const appB = await applyAndGetId(jobId, `${uniq("ivB")}@example.gov.in`);
    const interviewerId = randomUUID();

    const first = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: jobId, applicationId: appA, interviewerIds: [interviewerId], scheduledAt: "2027-03-01T10:00:00.000Z", durationMinutes: 60 },
    });
    expect(first.statusCode).toBe(201);
    await drain(); // persist it so the second request's overlap check can see it

    // Starts 30 minutes into the first interview's 60-minute window.
    const overlapping = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: jobId, applicationId: appB, interviewerIds: [interviewerId], scheduledAt: "2027-03-01T10:30:00.000Z", durationMinutes: 60 },
    });
    expect(overlapping.statusCode).toBe(409);
    expect(overlapping.json().code).toBe("INTERVIEWER_DOUBLE_BOOKED");
  });

  it("allows a non-overlapping, back-to-back interview for the same interviewer", async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const appA = await applyAndGetId(jobId, `${uniq("ivC")}@example.gov.in`);
    const appB = await applyAndGetId(jobId, `${uniq("ivD")}@example.gov.in`);
    const interviewerId = randomUUID();

    const first = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: jobId, applicationId: appA, interviewerIds: [interviewerId], scheduledAt: "2027-03-02T10:00:00.000Z", durationMinutes: 60 },
    });
    expect(first.statusCode).toBe(201);
    await drain();

    // Starts exactly when the first ends — half-open interval, not an overlap.
    const second = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: jobId, applicationId: appB, interviewerIds: [interviewerId], scheduledAt: "2027-03-02T11:00:00.000Z", durationMinutes: 60 },
    });
    expect(second.statusCode).toBe(201);
    await drain();

    // Actually persisted — f3-consumer.ts's own atomic re-check didn't also
    // reject this legitimate, non-overlapping booking.
    const rows = await asTenant((tx) => tx`select count(*)::int as n from recruitment.hrms_interviews where id = ${second.json().id}`);
    expect((rows[0] as { n: number }).n).toBe(1);
  });

  it("does not block a DIFFERENT interviewer at the exact same overlapping time", async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const appA = await applyAndGetId(jobId, `${uniq("ivE")}@example.gov.in`);
    const appB = await applyAndGetId(jobId, `${uniq("ivF")}@example.gov.in`);

    const first = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: jobId, applicationId: appA, interviewerIds: [randomUUID()], scheduledAt: "2027-03-03T10:00:00.000Z", durationMinutes: 60 },
    });
    expect(first.statusCode).toBe(201);
    await drain();

    const second = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: jobId, applicationId: appB, interviewerIds: [randomUUID()], scheduledAt: "2027-03-03T10:00:00.000Z", durationMinutes: 60 },
    });
    expect(second.statusCode).toBe(201);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("HIGH — screening decision now updates stage", () => {
  it('shortlisting an application sets stage to "shortlisted"', async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const appId = await applyAndGetId(jobId, `${uniq("scr-sl")}@example.gov.in`);

    const { statusCode } = await screeningDecision(appId, { decision: "shortlisted" });
    expect(statusCode).toBe(200);

    const row = await getApplicationRow(appId);
    expect(row?.stage).toBe("shortlisted");
    expect(row?.screening_decision).toBe("shortlisted");
  });

  it('rejecting (ineligible) an application sets stage to "rejected"', async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const appId = await applyAndGetId(jobId, `${uniq("scr-rej")}@example.gov.in`);

    const { statusCode } = await screeningDecision(appId, { decision: "ineligible", reasonCode: "eligibility" });
    expect(statusCode).toBe(200);

    const row = await getApplicationRow(appId);
    expect(row?.stage).toBe("rejected");
  });

  it("a decision with no pipeline-stage counterpart (waitlisted) leaves stage untouched", async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const appId = await applyAndGetId(jobId, `${uniq("scr-wl")}@example.gov.in`);

    const { statusCode } = await screeningDecision(appId, { decision: "waitlisted" });
    expect(statusCode).toBe(200);

    const row = await getApplicationRow(appId);
    expect(row?.stage).toBe("applied"); // unchanged from insert default
    expect(row?.screening_decision).toBe("waitlisted");
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("HIGH — department-scoped authorization: requisitions", () => {
  async function createRequisition(token: { authorization: string }, departmentId?: string): Promise<string> {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/requisitions", headers: { ...token, ...CT },
      payload: { title: uniq("Req"), ...(departmentId ? { departmentId } : {}) },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    return r.json().id as string;
  }

  it("a Finance manager can view a Finance requisition they did not create", async () => {
    const id = await createRequisition(auth(["hr_admin"]), DEPT_FIN);
    const r = await app.inject({ method: "GET", url: `/v1/hrms/requisitions/${id}`, headers: auth(["manager"], FIN_MGR_SUB) });
    expect(r.statusCode).toBe(200);
  });

  it("a Finance manager gets 404 for a PWD requisition they did not create (exists, but not theirs)", async () => {
    const id = await createRequisition(auth(["hr_admin"]), DEPT_PWD);
    const r = await app.inject({ method: "GET", url: `/v1/hrms/requisitions/${id}`, headers: auth(["manager"], FIN_MGR_SUB) });
    expect(r.statusCode).toBe(404);
  });

  it("the list endpoint includes a scoped manager's own department and excludes another's", async () => {
    const finReq = await createRequisition(auth(["hr_admin"]), DEPT_FIN);
    const pwdReq = await createRequisition(auth(["hr_admin"]), DEPT_PWD);

    const r = await app.inject({ method: "GET", url: "/v1/hrms/requisitions", headers: auth(["manager"], FIN_MGR_SUB) });
    expect(r.statusCode).toBe(200);
    const ids = (r.json().data as Array<{ id: string }>).map((x) => x.id);
    expect(ids).toContain(finReq);
    expect(ids).not.toContain(pwdReq);
  });

  it("a manager can still view/submit their OWN requisition even with no department set", async () => {
    const id = await createRequisition(auth(["manager"], FIN_MGR_SUB)); // no departmentId
    const getRes = await app.inject({ method: "GET", url: `/v1/hrms/requisitions/${id}`, headers: auth(["manager"], FIN_MGR_SUB) });
    expect(getRes.statusCode).toBe(200);

    const submitRes = await app.inject({ method: "POST", url: `/v1/hrms/requisitions/${id}/submit`, headers: auth(["manager"], FIN_MGR_SUB) });
    expect(submitRes.statusCode).toBe(200); // was previously ungated entirely -- also proves the new assertCanView call on submit doesn't break the legitimate case
  });

  it("a manager CANNOT submit another department's requisition into the approval pipeline", async () => {
    const id = await createRequisition(auth(["hr_admin"]), DEPT_PWD);
    const r = await app.inject({ method: "POST", url: `/v1/hrms/requisitions/${id}/submit`, headers: auth(["manager"], FIN_MGR_SUB) });
    expect(r.statusCode).toBe(404);
  });

  it("a manager with no resolvable employee link fails CLOSED (404), never falling back to tenant-wide", async () => {
    const id = await createRequisition(auth(["hr_admin"]), DEPT_FIN);
    const r = await app.inject({ method: "GET", url: `/v1/hrms/requisitions/${id}`, headers: auth(["manager"], UNLINKED_MGR_SUB) });
    expect(r.statusCode).toBe(404);
  });

  it("hr_officer (HR_ROLES but not ADMIN_ROLES) is unaffected — still tenant-wide for department", async () => {
    const id = await createRequisition(auth(["hr_admin"]), DEPT_PWD);
    const r = await app.inject({ method: "GET", url: `/v1/hrms/requisitions/${id}`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// Follow-up to the block above: /approve and /return were the two routes an
// independent review found NOT wired into department scoping — their only
// gate was the stage-role check (requireRole against the approval chain's
// current stage), and DEFAULT_GOVT_CHAIN's stage 0 role is literally
// "hiring_manager", one of the two roles this whole fix exists to constrain.
// Live-reproduced pre-fix: a hiring_manager seeded into one department, with
// no link to a requisition in a different department, got 200 (real stage
// advance / real rejection) from both routes while correctly getting 404 from
// GET. This block proves that gap is now closed the same way /submit and
// /clone above are: assertCanView ADDED alongside the existing stage-role
// gate, not replacing it — both must pass.
describe("HIGH — department-scoped authorization: requisition approve/return", () => {
  async function createRequisition(token: { authorization: string }, departmentId?: string): Promise<string> {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/requisitions", headers: { ...token, ...CT },
      payload: { title: uniq("ReqAR"), ...(departmentId ? { departmentId } : {}) },
    });
    expect(r.statusCode).toBe(201);
    await drain();
    return r.json().id as string;
  }

  /** hr_admin (HR's own token) both creates and submits, so the actor who
   *  later approves/returns below is never the requisition's creator — keeps
   *  these tests clear of the unrelated SOD_VIOLATION "creator cannot approve
   *  their own requisition" gate, which is not what's under test here. */
  async function createAndSubmitRequisition(departmentId: string): Promise<string> {
    const id = await createRequisition(auth(["hr_admin"]), departmentId);
    const submitRes = await app.inject({ method: "POST", url: `/v1/hrms/requisitions/${id}/submit`, headers: auth(["hr_admin"]) });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().currentStage).toBe(0); // stage 0 = hiring_manager (DEFAULT_GOVT_CHAIN)
    await drain();
    return id;
  }

  it("a Finance hiring_manager CANNOT approve a PWD requisition, even holding the correct stage-role (404)", async () => {
    const id = await createAndSubmitRequisition(DEPT_PWD);
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/requisitions/${id}/approve`, headers: { ...auth(["hiring_manager"], FIN_MGR_SUB), ...CT }, payload: {},
    });
    expect(r.statusCode).toBe(404); // same "hide existence" convention as GET/submit — not 403
  });

  it("a Finance hiring_manager CANNOT return a PWD requisition, even holding the correct stage-role (404)", async () => {
    const id = await createAndSubmitRequisition(DEPT_PWD);
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/requisitions/${id}/return`, headers: { ...auth(["hiring_manager"], FIN_MGR_SUB), ...CT },
      payload: { comments: "insufficient budget justification" },
    });
    expect(r.statusCode).toBe(404);
  });

  it("a PWD hiring_manager correctly scoped to their OWN department CAN approve it", async () => {
    const id = await createAndSubmitRequisition(DEPT_PWD);
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/requisitions/${id}/approve`, headers: { ...auth(["hiring_manager"], PWD_MGR_SUB), ...CT }, payload: {},
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "pending_approval", currentStage: 1 }); // advanced past stage 0
  });

  it("a PWD hiring_manager correctly scoped to their OWN department CAN return it", async () => {
    const id = await createAndSubmitRequisition(DEPT_PWD);
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/requisitions/${id}/return`, headers: { ...auth(["hiring_manager"], PWD_MGR_SUB), ...CT },
      payload: { comments: "please add SC/ST reservation breakdown" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("returned");
  });

  it("super_admin (tenant-wide) remains unaffected — can approve a PWD requisition despite no department link", async () => {
    const id = await createAndSubmitRequisition(DEPT_PWD);
    // UNLINKED_MGR_SUB has no hrms_employees row at all — proves this passes
    // because super_admin is exempt (TENANT_WIDE_ROLES), not by accident of
    // some resolvable department.
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/requisitions/${id}/approve`, headers: { ...auth(["super_admin"], UNLINKED_MGR_SUB), ...CT }, payload: {},
    });
    expect(r.statusCode).toBe(200);
  });

  it("super_admin (tenant-wide) remains unaffected — can return a PWD requisition despite no department link", async () => {
    const id = await createAndSubmitRequisition(DEPT_PWD);
    const r = await app.inject({
      method: "POST", url: `/v1/hrms/requisitions/${id}/return`, headers: { ...auth(["super_admin"], UNLINKED_MGR_SUB), ...CT },
      payload: { comments: "policy change, restart pipeline" },
    });
    expect(r.statusCode).toBe(200);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("HIGH — department-scoped authorization: interviews", () => {
  it("a Finance manager's interview list excludes a PWD job opening's interviews", async () => {
    const pwdJob = await createJobOpening(DEPT_PWD);
    const appId = await applyAndGetId(pwdJob, `${uniq("dept-iv")}@example.gov.in`);
    const created = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: pwdJob, applicationId: appId, interviewerIds: [randomUUID()], scheduledAt: "2027-04-01T09:00:00.000Z", durationMinutes: 30 },
    });
    expect(created.statusCode).toBe(201);
    await drain();

    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews?jobOpeningId=${pwdJob}`, headers: auth(["manager"], FIN_MGR_SUB) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toEqual([]); // scoped list: empty, not an error
  });

  it("a Finance manager CANNOT schedule an interview against a PWD job opening (404)", async () => {
    const pwdJob = await createJobOpening(DEPT_PWD);
    const appId = await applyAndGetId(pwdJob, `${uniq("dept-iv2")}@example.gov.in`);

    const r = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(["manager"], FIN_MGR_SUB), ...CT },
      payload: { jobOpeningId: pwdJob, applicationId: appId, interviewerIds: [randomUUID()], scheduledAt: "2027-04-02T09:00:00.000Z", durationMinutes: 30 },
    });
    expect(r.statusCode).toBe(404);
  });

  it("a Finance manager CAN schedule and then list an interview for a Finance job opening", async () => {
    const finJob = await createJobOpening(DEPT_FIN);
    const appId = await applyAndGetId(finJob, `${uniq("dept-iv3")}@example.gov.in`);

    const created = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(["manager"], FIN_MGR_SUB), ...CT },
      payload: { jobOpeningId: finJob, applicationId: appId, interviewerIds: [randomUUID()], scheduledAt: "2027-04-03T09:00:00.000Z", durationMinutes: 30 },
    });
    expect(created.statusCode).toBe(201);
    await drain();

    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews?jobOpeningId=${finJob}`, headers: auth(["manager"], FIN_MGR_SUB) });
    expect(r.statusCode).toBe(200);
    expect((r.json().data as Array<{ id: string }>).map((x) => x.id)).toContain(created.json().id);
  });

  it("hr_admin (tenant-wide) is unaffected — sees a PWD job opening's interviews too", async () => {
    const pwdJob = await createJobOpening(DEPT_PWD);
    const appId = await applyAndGetId(pwdJob, `${uniq("dept-iv4")}@example.gov.in`);
    const created = await app.inject({
      method: "POST", url: "/v1/hrms/interviews", headers: { ...auth(), ...CT },
      payload: { jobOpeningId: pwdJob, applicationId: appId, interviewerIds: [randomUUID()], scheduledAt: "2027-04-04T09:00:00.000Z", durationMinutes: 30 },
    });
    await drain();

    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews?jobOpeningId=${pwdJob}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect((r.json().data as Array<{ id: string }>).map((x) => x.id)).toContain(created.json().id);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("MEDIUM — talent pool defaults to excluding active-pipeline stages", () => {
  it("excludes a shortlisted (active) candidate by default, includes a rejected (available) one", async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const activeEmail = `${uniq("tp-active")}@example.gov.in`;
    const availableEmail = `${uniq("tp-avail")}@example.gov.in`;
    const activeApp = await applyAndGetId(jobId, activeEmail);
    const availableApp = await applyAndGetId(jobId, availableEmail);

    await screeningDecision(activeApp, { decision: "shortlisted" });
    await screeningDecision(availableApp, { decision: "ineligible", reasonCode: "eligibility" });

    const r = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=200", headers: auth() });
    expect(r.statusCode).toBe(200);
    const emails = (r.json().data as Array<{ email: string }>).map((c) => c.email);
    expect(emails).not.toContain(activeEmail);
    expect(emails).toContain(availableEmail);
  });

  it("includeActive=true restores the full unfiltered (pre-fix) view", async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const activeEmail = `${uniq("tp-active2")}@example.gov.in`;
    const activeApp = await applyAndGetId(jobId, activeEmail);
    await screeningDecision(activeApp, { decision: "shortlisted" });

    const r = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=200&includeActive=true", headers: auth() });
    expect(r.statusCode).toBe(200);
    const emails = (r.json().data as Array<{ email: string }>).map((c) => c.email);
    expect(emails).toContain(activeEmail);
  });

  it("an explicit stage filter returns only that stage, overriding the default", async () => {
    const jobId = await createJobOpening(DEPT_FIN);
    const email = `${uniq("tp-stage")}@example.gov.in`;
    const appId = await applyAndGetId(jobId, email);
    await screeningDecision(appId, { decision: "shortlisted" });

    const r = await app.inject({ method: "GET", url: "/v1/hrms/talent-pool?limit=200&stage=shortlisted", headers: auth() });
    expect(r.statusCode).toBe(200);
    const emails = (r.json().data as Array<{ email: string }>).map((c) => c.email);
    expect(emails).toContain(email);
  });
});

// ═══════════════════════════════════════════════════════════════════════
describe("MEDIUM — JD-template linkage", () => {
  async function createTemplate(): Promise<string> {
    const r = await app.inject({
      method: "POST", url: "/v1/hrms/jd-templates", headers: { ...auth(), ...CT },
      payload: {
        name: uniq("Template"), vacancyType: "regular",
        qualification: "B.Tech / MCA", payRange: "Level 10",
        selectionProcess: "Written test then interview",
        requiredDocuments: ["Aadhaar", "Degree Certificate"],
        eligibility: { minAge: 21, maxAge: 35 },
      },
    });
    expect(r.statusCode).toBe(202);
    const id = r.json().id as string;
    await drain();
    return id;
  }

  async function getTemplateUseCount(id: string): Promise<number> {
    const rows = await asTenant((tx) => tx`select use_count from recruitment.hrms_jd_templates where id = ${id}`);
    return (rows[0] as { use_count: number } | undefined)?.use_count ?? -1;
  }

  it("POST .../use carries payRange/selectionProcess/requiredDocuments/eligibility/qualification through, and bumps useCount by exactly 1", async () => {
    const templateId = await createTemplate();
    expect(await getTemplateUseCount(templateId)).toBe(0);

    const r = await app.inject({
      method: "POST", url: `/v1/hrms/jd-templates/${templateId}/use`, headers: { ...auth(), ...CT },
      payload: { departmentId: DEPT_FIN },
    });
    expect(r.statusCode).toBe(202);
    const jobId = r.json().id as string;
    await drain();

    const rows = await asTenant((tx) => tx`
      select template_id, pay_range, selection_process, required_documents, eligibility, qualification
      from recruitment.hrms_job_openings where id = ${jobId}
    `);
    const row = rows[0] as {
      template_id: string; pay_range: string; selection_process: string;
      required_documents: string[]; eligibility: Record<string, unknown>; qualification: string;
    };
    expect(row.template_id).toBe(templateId);
    expect(row.pay_range).toBe("Level 10");
    expect(row.selection_process).toBe("Written test then interview");
    expect(row.required_documents).toEqual(["Aadhaar", "Degree Certificate"]);
    expect(row.eligibility).toEqual({ minAge: 21, maxAge: 35 });
    expect(row.qualification).toBe("B.Tech / MCA");

    expect(await getTemplateUseCount(templateId)).toBe(1); // exactly once, not double-counted
  });

  it("a direct POST /v1/hrms/job-openings with templateId also carries fields through and bumps useCount", async () => {
    const templateId = await createTemplate();

    const r = await app.inject({
      method: "POST", url: "/v1/hrms/job-openings", headers: { ...auth(), ...CT },
      payload: {
        refNo: uniq("DIRECT"), title: "Direct-from-template Role", departmentId: DEPT_FIN,
        templateId, qualification: "B.Tech / MCA", payRange: "Level 10",
        selectionProcess: "Written test then interview",
        requiredDocuments: ["Aadhaar", "Degree Certificate"], eligibility: { minAge: 21, maxAge: 35 },
      },
    });
    expect(r.statusCode).toBe(202);
    const jobId = r.json().id as string;
    await drain();

    const rows = await asTenant((tx) => tx`select template_id, required_documents from recruitment.hrms_job_openings where id = ${jobId}`);
    const row = rows[0] as { template_id: string; required_documents: string[] };
    expect(row.template_id).toBe(templateId);
    expect(row.required_documents).toEqual(["Aadhaar", "Degree Certificate"]);

    expect(await getTemplateUseCount(templateId)).toBe(1);
  });

  it("creating a job opening WITHOUT a templateId never touches useCount", async () => {
    const templateId = await createTemplate();
    await createJobOpening(DEPT_FIN); // unrelated job opening, no templateId
    expect(await getTemplateUseCount(templateId)).toBe(0);
  });
});
