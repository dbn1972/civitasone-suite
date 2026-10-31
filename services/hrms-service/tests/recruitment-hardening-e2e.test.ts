/**
 * Recruitment hardening — real-Postgres end-to-end regression suite.
 *
 * Covers the three CRITICAL bugs hardened in the LIVE apply -> offer -> hire
 * shortcut path (routes.ts / consumer.ts / commands.ts), against a real
 * database rather than mocks, so the actual migrations/constraints/indexes
 * are what's enforcing each guard:
 *
 *   Bug 1 — an offer on a withdrawn/rejected/already-hired application must
 *           be rejected (repo.claimApplicationForOffer + routes.ts's
 *           synchronous pre-check).
 *   Bug 2 — a duplicate application (same email, same vacancy) must be
 *           rejected on BOTH live apply paths, including the public one
 *           (dedup_key + hrms_applications_dedup_uq).
 *   Bug 3 — hiring beyond a job opening's vacancies must be rejected,
 *           including under genuine concurrency for the last vacancy
 *           (repo.claimVacancy, a real atomic UPDATE ... WHERE vacancies > 0
 *           racing two actually-concurrent consumer invocations against
 *           Postgres row locking -- not a simulated mock).
 *
 * Each bug's bad-sequence test is paired with proof that the legitimate flow
 * (screening -> shortlist -> offer -> hire, for a fresh unique applicant,
 * within vacancy limits) still works end-to-end.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { testDbHostPort } from "../../../vitest.testdb";
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

// applicationCreate/applicationOffer/applicationHire (routes.ts + commands.ts)
// only publish to the regular command queue; the F3 write path (eligibility
// withdraw, screening-decision) is separate. Register both once so this
// suite exercises the whole write path, not just the HTTP accept layer.
registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);
async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001"; // core-seed's fixed demo tenant
const HR = "aaaaaaaa-e2e1-4000-8000-000000000001";
// From tests/fixtures/core-seed.ts — guaranteed to exist once seeded.
const DEPT = "eeeeeeee-0001-0000-0000-000000000001"; // Finance
const DESIG = "eeeeeeee-0001-0000-0000-000000000003"; // IAS Officer

const CT = { "content-type": "application/json" };
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${signToken({ sub: HR, tid: TENANT, roles, sid: "s" }, SECRET)}` });
const authAs = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}` });
const OFFER_CHAIN_ROLES = ["hr_admin", "finance_officer", "legal_officer", "competent_authority"];
const uniq = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

let app: FastifyInstance;
let db: postgres.Sql;

beforeAll(async () => {
  await seedHrmsCoreFixtures();
  app = await buildApp();
  db = postgres(process.env.DATABASE_URL ?? `postgres://hrms_svc:hrms_dev_pw@${testDbHostPort()}/civitas_hrms`, { max: 5 });
  // This suite exercises the legacy single-step offer shortcut (PATCH .../offer). Since GAP-RECRUITMENT-DETAIL-05 that
  // shortcut is refused by default (offers must go through the approval workflow), so the tenant opts out here --
  // the policy itself is covered by its own describe block below.
  await setOfferWorkflowRequired(false);
});
afterAll(async () => {
  await asTenant((tx) => tx`delete from recruitment.hrms_recruitment_settings where tenant_id = ${TENANT}`);
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

async function setOfferWorkflowRequired(on: boolean): Promise<void> {
  await asTenant((tx) => tx`
    insert into recruitment.hrms_recruitment_settings (tenant_id, updated_by, offer_workflow_required)
    values (${TENANT}, ${HR}, ${on})
    on conflict (tenant_id) do update set offer_workflow_required = excluded.offer_workflow_required`);
}

/** hrms-service tables are FORCE RLS -- every read/write needs app.tenant_id set (see core-seed.ts). */
async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT}', true)`);
    return fn(tx);
  });
}

async function createJobOpening(vacancies: number, opts: { isPublished?: boolean } = {}): Promise<string> {
  const r = await app.inject({
    method: "POST", url: "/v1/hrms/job-openings", headers: { ...auth(), ...CT },
    payload: { refNo: uniq("RCT"), title: "Recruitment Hardening Test Role", departmentId: DEPT, vacancies, isPublished: opts.isPublished ?? false },
  });
  expect(r.statusCode).toBe(202);
  const id = r.json().id as string;
  await drain();
  return id;
}

async function applyHrAssisted(jobOpeningId: string, email: string): Promise<{ statusCode: number; body: any }> {
  const r = await app.inject({
    method: "POST", url: "/v1/hrms/applications", headers: { ...auth(), ...CT },
    payload: { jobOpeningId, applicantName: "Hardening Test Candidate", email },
  });
  await drain();
  return { statusCode: r.statusCode, body: r.json() };
}

async function applyPublic(jobOpeningId: string, email: string): Promise<{ statusCode: number; body: any }> {
  const r = await app.inject({
    method: "POST", url: "/v1/careers/apply", headers: CT,
    payload: { tenantId: TENANT, jobOpeningId, applicantName: "Hardening Public Candidate", email, consent: true, consentVersion: "2026-10-v1" },
  });
  await drain();
  return { statusCode: r.statusCode, body: r.json() };
}

async function shortlist(applicationId: string): Promise<void> {
  const r = await app.inject({
    method: "POST", url: `/v1/hrms/applications/${applicationId}/screening-decision`, headers: { ...auth(), ...CT },
    payload: { decision: "shortlisted" },
  });
  await drain();
  expect(r.statusCode).toBe(200);
}

/** The legacy PATCH .../offer alone: since UAT F85 it only submits the offer into the approval chain. */
async function legacyOffer(applicationId: string): Promise<{ statusCode: number; body: any }> {
  const r = await app.inject({
    method: "PATCH", url: `/v1/hrms/applications/${applicationId}/offer`, headers: { ...auth(), ...CT },
    payload: { ctcMinor: 8_00_000_00 },
  });
  await drain();
  return { statusCode: r.statusCode, body: r.json() };
}

async function approveAs(offerId: string, actor: string, role: string): Promise<{ statusCode: number; body: any }> {
  const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/approve`, headers: { ...authAs(actor, [role]), ...CT }, payload: {} });
  await drain();
  return { statusCode: r.statusCode, body: r.json() };
}

async function release(offerId: string): Promise<{ statusCode: number; body: any }> {
  const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/release`, headers: { ...auth(), ...CT }, payload: {} });
  await drain();
  return { statusCode: r.statusCode, body: r.json() };
}

async function getOffer(offerId: string) {
  const [row] = await asTenant((tx) => tx`select status, current_stage, created_by, released_at from recruitment.hrms_offers where id = ${offerId}`);
  return row as { status: string; current_stage: number; created_by: string; released_at: Date | null } | undefined;
}

/**
 * Make an offer the way a tenant with the legacy shortcut enabled must now do it (UAT F85): the PATCH
 * submits it, then each chain stage is approved by a DIFFERENT non-creator approver, then HR releases it
 * -- only the release moves the application to "offered", which the hire tests below need.
 */
async function offer(applicationId: string): Promise<{ statusCode: number; body: any }> {
  const res = await legacyOffer(applicationId);
  if (res.statusCode !== 202) return res;
  const offerId = res.body.id as string;
  for (const role of OFFER_CHAIN_ROLES) expect((await approveAs(offerId, randomUUID(), role)).statusCode).toBe(200);
  expect((await release(offerId)).statusCode).toBe(200);
  return res;
}

async function hire(applicationId: string, employeeNo: string): Promise<{ statusCode: number; body: any }> {
  const r = await app.inject({
    method: "POST", url: `/v1/hrms/applications/${applicationId}/hire`, headers: { ...auth(), ...CT },
    payload: { employeeNo, dateOfJoining: "2026-08-01", basicMinor: 3_00_000_00, departmentId: DEPT, designationId: DESIG },
  });
  await drain();
  return { statusCode: r.statusCode, body: r.json() };
}

async function getApplication(id: string) {
  const [row] = await asTenant((tx) => tx`select stage, status, dedup_key from recruitment.hrms_applications where id = ${id}`);
  return row as { stage: string; status: string; dedup_key: string | null } | undefined;
}
async function getJobOpening(id: string) {
  const [row] = await asTenant((tx) => tx`select vacancies, status from recruitment.hrms_job_openings where id = ${id}`);
  return row as { vacancies: number; status: string } | undefined;
}
async function countApplications(jobOpeningId: string, email: string) {
  const [row] = await asTenant((tx) => tx`select count(*)::int as n from recruitment.hrms_applications where job_opening_id = ${jobOpeningId} and lower(email) = ${email.toLowerCase()}`);
  return (row as { n: number }).n;
}
async function findEmployeeByNo(employeeNo: string) {
  const [row] = await asTenant((tx) => tx`select id, department_id, designation_id from employee.hrms_employees where employee_no = ${employeeNo}`);
  return row as { id: string; department_id: string; designation_id: string } | undefined;
}

describe("Recruitment hardening — legitimate flow still works end-to-end", () => {
  it("screening -> shortlist -> offer -> hire succeeds for a fresh unique applicant, within vacancy limits", async () => {
    const jobId = await createJobOpening(2);
    const email = `${uniq("candidate")}@example.gov.in`;
    const applyRes = await applyHrAssisted(jobId, email);
    expect(applyRes.statusCode).toBe(202);
    const applicationId = applyRes.body.id as string;

    await shortlist(applicationId);

    const offerRes = await offer(applicationId);
    expect(offerRes.statusCode).toBe(202);
    let appRow = await getApplication(applicationId);
    expect(appRow?.stage).toBe("offered");

    const employeeNo = uniq("EMP");
    const hireRes = await hire(applicationId, employeeNo);
    expect(hireRes.statusCode).toBe(202);

    appRow = await getApplication(applicationId);
    expect(appRow?.stage).toBe("hired");
    expect(appRow?.status).toBe("joined"); // recruitment hardening: was the invalid "closed" value

    const employee = await findEmployeeByNo(employeeNo);
    expect(employee).toBeDefined();
    expect(employee?.department_id).toBe(DEPT);
    expect(employee?.designation_id).toBe(DESIG);

    // Bug 3: one of the job opening's 2 vacancies was atomically consumed.
    const job = await getJobOpening(jobId);
    expect(job?.vacancies).toBe(1);
    expect(job?.status).toBe("open");
  });
});

describe("Bug 1 — offer state-machine hardening", () => {
  it("rejects PATCH .../offer on a withdrawn application (409 INVALID_STATE)", async () => {
    const jobId = await createJobOpening(1);
    const email = `${uniq("withdrawn")}@example.gov.in`;
    const { body: applied } = await applyHrAssisted(jobId, email);
    const applicationId = applied.id as string;

    const withdrawRes = await app.inject({
      method: "POST", url: `/v1/hrms/applications/${applicationId}/withdraw`, headers: { ...auth(), ...CT },
      payload: { reason: "candidate found another position" },
    });
    await drain();
    expect(withdrawRes.statusCode).toBe(200);
    expect((await getApplication(applicationId))?.status).toBe("withdrawn");

    const offerRes = await offer(applicationId);
    expect(offerRes.statusCode).toBe(409);
    expect(offerRes.body.code).toBe("INVALID_STATE");
    // No offer stage transition happened.
    expect((await getApplication(applicationId))?.stage).not.toBe("offered");
  });

  it("rejects a second offer on an application that is already hired (409 INVALID_STATE)", async () => {
    const jobId = await createJobOpening(1);
    const email = `${uniq("rehire")}@example.gov.in`;
    const { body: applied } = await applyHrAssisted(jobId, email);
    const applicationId = applied.id as string;
    await offer(applicationId);
    await hire(applicationId, uniq("EMP"));
    expect((await getApplication(applicationId))?.stage).toBe("hired");

    const secondOffer = await offer(applicationId);
    expect(secondOffer.statusCode).toBe(409);
    expect(secondOffer.body.code).toBe("INVALID_STATE");
  });
});

describe("Bug 2 — duplicate-application hardening (dedup_key + hrms_applications_dedup_uq)", () => {
  it("rejects a duplicate application via the HR-assisted path (POST /v1/hrms/applications)", async () => {
    const jobId = await createJobOpening(5);
    const email = `${uniq("dup-hr")}@example.gov.in`;

    const first = await applyHrAssisted(jobId, email);
    expect(first.statusCode).toBe(202);
    const second = await applyHrAssisted(jobId, email);
    expect(second.statusCode).toBe(202); // still 202 -- the command is accepted; the consumer suppresses the actual duplicate insert

    // Exactly ONE row landed for (job opening, email) -- the DB's own unique
    // index caught the second insert as a 23505, gracefully suppressed by
    // the consumer rather than creating a duplicate row.
    expect(await countApplications(jobId, email)).toBe(1);
  });

  it("rejects a duplicate application via the PUBLIC path (POST /v1/careers/apply)", async () => {
    const jobId = await createJobOpening(5, { isPublished: true });
    const email = `${uniq("dup-public")}@example.gov.in`;

    const first = await applyPublic(jobId, email);
    expect(first.statusCode).toBe(202);
    const second = await applyPublic(jobId, email);
    expect(second.statusCode).toBe(409);

    expect(await countApplications(jobId, email)).toBe(1);
  });

  it("still allows the SAME email to apply to two DIFFERENT job openings", async () => {
    const jobA = await createJobOpening(3);
    const jobB = await createJobOpening(3);
    const email = `${uniq("cross-job")}@example.gov.in`;

    expect((await applyHrAssisted(jobA, email)).statusCode).toBe(202);
    expect((await applyHrAssisted(jobB, email)).statusCode).toBe(202);

    expect(await countApplications(jobA, email)).toBe(1);
    expect(await countApplications(jobB, email)).toBe(1);
  });
});

describe("Bug 3 — vacancy-cap hardening (repo.claimVacancy, atomic UPDATE ... WHERE vacancies > 0)", () => {
  it("rejects hiring beyond the job opening's vacancies (sequential over-hire)", async () => {
    const jobId = await createJobOpening(1);

    // Both candidates apply and are offered WHILE the opening still shows 1
    // vacancy (HR extended two offers hoping only one accepts) -- the
    // over-limit only bites at HIRE time, which is exactly what Bug 3 is
    // about. Applying/offering after the opening is already "filled" would
    // be correctly rejected earlier by isApplicationOpen()/the offer
    // precondition, which isn't the scenario under test here.
    const emailA = `${uniq("vacA")}@example.gov.in`;
    const emailB = `${uniq("vacB")}@example.gov.in`;
    const empNoA = uniq("EMP");
    const empNoB = uniq("EMP");
    const { body: appA } = await applyHrAssisted(jobId, emailA);
    const { body: appB } = await applyHrAssisted(jobId, emailB);
    await offer(appA.id);
    await offer(appB.id);

    const hireA = await hire(appA.id, empNoA);
    expect(hireA.statusCode).toBe(202);
    expect((await getApplication(appA.id))?.stage).toBe("hired");

    let job = await getJobOpening(jobId);
    expect(job?.vacancies).toBe(0);
    expect(job?.status).toBe("filled");

    const hireB = await hire(appB.id, empNoB);
    expect(hireB.statusCode).toBe(202); // command accepted; consumer rejects the actual hire

    // The second application was NOT hired -- the whole hire transaction
    // rolled back (including the claimApplicationForHire claim), leaving it
    // back in "offered" for HR to reassign, and no second employee exists.
    const appBRow = await getApplication(appB.id);
    expect(appBRow?.stage).toBe("offered");
    expect(await findEmployeeByNo(empNoB)).toBeUndefined();
    job = await getJobOpening(jobId);
    expect(job?.vacancies).toBe(0);
  });

  it("under genuine concurrency, claims the last vacancy for exactly ONE of two simultaneous hires", async () => {
    const jobId = await createJobOpening(1);

    const emailA = `${uniq("raceA")}@example.gov.in`;
    const emailB = `${uniq("raceB")}@example.gov.in`;
    const { body: appA } = await applyHrAssisted(jobId, emailA);
    const { body: appB } = await applyHrAssisted(jobId, emailB);
    await offer(appA.id);
    await offer(appB.id);

    const empNoA = uniq("EMP-RACE-A");
    const empNoB = uniq("EMP-RACE-B");
    // Genuinely concurrent: both HTTP requests (and the async command
    // processing they kick off) are in flight together, so the two
    // consumer invocations' claimVacancy UPDATEs race for real against
    // Postgres row-level locking -- not a simulated/mocked race.
    const [resA, resB] = await Promise.all([
      hire(appA.id, empNoA),
      hire(appB.id, empNoB),
    ]);
    expect(resA.statusCode).toBe(202);
    expect(resB.statusCode).toBe(202);

    const [rowA, rowB] = await Promise.all([getApplication(appA.id), getApplication(appB.id)]);
    const stages = [rowA?.stage, rowB?.stage].sort();
    // Exactly one hired, one still offered -- never both hired, never both
    // stuck offered.
    expect(stages).toEqual(["hired", "offered"]);

    const [empA, empB] = await Promise.all([findEmployeeByNo(empNoA), findEmployeeByNo(empNoB)]);
    const employeesCreated = [empA, empB].filter(Boolean).length;
    expect(employeesCreated).toBe(1);

    const job = await getJobOpening(jobId);
    expect(job?.vacancies).toBe(0);
    expect(job?.status).toBe("filled");
  });
});

describe("Minor-item hardening — FK existence checks before hire", () => {
  it("rejects a hire with a departmentId that doesn't exist for this tenant", async () => {
    const jobId = await createJobOpening(1);
    const email = `${uniq("baddept")}@example.gov.in`;
    const { body: applied } = await applyHrAssisted(jobId, email);
    await offer(applied.id);

    const r = await app.inject({
      method: "POST", url: `/v1/hrms/applications/${applied.id}/hire`, headers: { ...auth(), ...CT },
      payload: { employeeNo: uniq("EMP"), dateOfJoining: "2026-08-01", basicMinor: 3_00_000_00, departmentId: randomUUID(), designationId: DESIG },
    });
    await drain();
    expect(r.statusCode).toBe(202); // accepted; consumer rejects it

    // Rolled back: still offered, no employee, vacancy not consumed.
    expect((await getApplication(applied.id))?.stage).toBe("offered");
    const job = await getJobOpening(jobId);
    expect(job?.vacancies).toBe(1);
  });
});


describe("GAP-RECRUITMENT-DETAIL-05 — the single-step offer shortcut is refused while the approval workflow is required", () => {
  it("PATCH .../offer is 409 LEGACY_OFFER_DISABLED by default and writes no offer or stage change; switching the policy off restores it", async () => {
    const job = await createJobOpening(2);
    const applied = await applyHrAssisted(job, `${uniq("wf")}@example.com`);
    const applicationId = applied.body.id as string;
    await shortlist(applicationId);

    await setOfferWorkflowRequired(true);
    try {
      const refused = await offer(applicationId);
      expect(refused.statusCode).toBe(409);
      expect(refused.body.code).toBe("LEGACY_OFFER_DISABLED");
      const [stage] = await asTenant((tx) => tx`select stage from recruitment.hrms_applications where id = ${applicationId}`);
      expect(stage?.stage).toBe("shortlisted");
      const offers = await asTenant((tx) => tx`select count(*)::int as n from recruitment.hrms_offers where application_id = ${applicationId}`);
      expect(offers[0]?.n).toBe(0);
    } finally {
      await setOfferWorkflowRequired(false);
    }
    const allowed = await offer(applicationId);
    expect(allowed.statusCode).toBe(202);
  });
});

describe("UAT F85 -- the legacy offer route, even when a tenant enables it, cannot bypass the approval chain", () => {
  it("PATCH .../offer only submits a pending_approval offer; the creator cannot approve, one approver cannot clear two stages, nothing is released or hireable until distinct approvers approve every stage", async () => {
    const job = await createJobOpening(1);
    const applied = await applyHrAssisted(job, `${uniq("f85")}@example.com`);
    const applicationId = applied.body.id as string;
    await shortlist(applicationId);

    const submitted = await legacyOffer(applicationId);
    expect(submitted.statusCode).toBe(202);
    const offerId = submitted.body.id as string;
    let row = await getOffer(offerId);
    expect(row).toMatchObject({ status: "pending_approval", current_stage: 0, created_by: HR, released_at: null });
    // Not sent, and not hireable: the application stays where it was.
    expect((await getApplication(applicationId))?.stage).toBe("shortlisted");
    const earlyHire = await hire(applicationId, uniq("EMP"));
    expect(earlyHire.statusCode).toBe(409);
    expect(earlyHire.body.code).toBe("INVALID_STATE");
    expect((await release(offerId)).body.code).toBe("NOT_APPROVED");

    // Maker-checker: the HR user who made the offer cannot approve it.
    const self = await approveAs(offerId, HR, "hr_admin");
    expect(self.statusCode).toBe(409);
    expect(self.body.code).toBe("SOD_VIOLATION");

    // Distinct approvers (F70): whoever cleared stage 0 cannot also clear stage 1.
    const checker = randomUUID();
    expect((await approveAs(offerId, checker, "hr_admin")).statusCode).toBe(200);
    const twice = await approveAs(offerId, checker, "finance_officer");
    expect(twice.statusCode).toBe(409);
    expect(twice.body.code).toBe("SOD_VIOLATION");
    row = await getOffer(offerId);
    expect(row).toMatchObject({ status: "pending_approval", current_stage: 1 });

    for (const role of OFFER_CHAIN_ROLES.slice(1)) expect((await approveAs(offerId, randomUUID(), role)).statusCode).toBe(200);
    expect((await getOffer(offerId))?.status).toBe("approved");
    expect((await getApplication(applicationId))?.stage).toBe("shortlisted");
    expect((await release(offerId)).statusCode).toBe(200);
    expect((await getOffer(offerId))?.status).toBe("released");
    expect((await getApplication(applicationId))?.stage).toBe("offered");
  });
});
