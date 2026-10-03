/**
 * fin-recruitment-01 -- real-Postgres end-to-end regression suite (migration 0180):
 *  - settings: PUT -> consumer -> GET public organisation / HR settings (+ audit)
 *  - DETAIL-08 / TALENT-POOL-02: list masks contact; reveal-contact writes the audit event; talent pool role gate
 *  - DETAIL-05: offer workflow with pay level/cell; maker != checker through the real chain; release moves the
 *    application to "offered"; the legacy PATCH shortcut is refused by default
 *  - DETAIL-03: horizontal reservations persist and round-trip; the approved roster drives the shortlist
 *  - CAREERS-DETAIL-03: the public apply stores category (lower case) and date of birth
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
import { registerRecruitmentFinishConsumers } from "../src/modules/recruitment/finish-consumer.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);
registerRecruitmentFinishConsumers(queue);
async function drain(): Promise<void> { await (queue as unknown as MemoryQueue).drain(); }

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
// Own tenant: recruitment-hardening-e2e writes (and deletes) the shared demo tenant's settings row, so this suite must
// not touch tenant ...0001 -- the two files run in parallel workers.
const TENANT = "00000000-0000-0000-0000-0000000f0101";
const DEPT = "eeeeeeee-0001-0000-0000-000000000001";
const CT = { "content-type": "application/json" };
const U = { admin: "aaaaaaaa-f101-4000-8000-000000000001", officer: "aaaaaaaa-f101-4000-8000-000000000002", fin: "aaaaaaaa-f101-4000-8000-000000000003", legal: "aaaaaaaa-f101-4000-8000-000000000004", ca: "aaaaaaaa-f101-4000-8000-000000000005", hr2: "aaaaaaaa-f101-4000-8000-000000000006" };
const as = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}` });
const uniq = (l: string) => `${l}-${randomUUID().slice(0, 8)}`;

let app: FastifyInstance;
let db: postgres.Sql;
async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${TENANT}', true)`);
    return fn(tx);
  });
}

beforeAll(async () => {
  await seedHrmsCoreFixtures();
  db = postgres(process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms", { max: 5 });
  app = await buildApp();
  await asTenant((tx) => tx`delete from recruitment.hrms_recruitment_settings where tenant_id = ${TENANT}`);
});
afterAll(async () => {
  await asTenant((tx) => tx`delete from recruitment.hrms_recruitment_settings where tenant_id = ${TENANT}`);
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

async function audits(action: string, resourceId: string): Promise<Array<Record<string, unknown>>> {
  const rows = await asTenant((tx) => tx`
    select payload from _outbox.messages
    where topic = 'audit.event.record' and payload->>'action' = ${action} and payload->>'resourceId' = ${resourceId}
    order by created_at`);
  return rows.map((r) => r.payload as Record<string, unknown>);
}

async function createJob(vacancies = 3): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/hrms/job-openings", headers: { ...as(U.admin, ["hr_admin"]), ...CT },
    payload: { refNo: uniq("F01"), title: "Fin01 Test Role", departmentId: DEPT, vacancies, isPublished: true } });
  expect(r.statusCode).toBe(202);
  await drain();
  return r.json().id as string;
}

async function applyPublic(jobId: string, email: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await app.inject({ method: "POST", url: "/v1/careers/apply", headers: CT,
    payload: { tenantId: TENANT, jobOpeningId: jobId, applicantName: "Fin01 Candidate", email, mobile: "9876543210", consent: true, consentVersion: "2026-10-v1", ...extra } });
  await drain();
  expect(r.statusCode, r.body).toBe(202);
  return r.json().id as string;
}

async function shortlist(appId: string): Promise<void> {
  const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/screening-decision`, headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: { decision: "shortlisted" } });
  await drain();
  expect(r.statusCode).toBe(200);
}

describe("recruitment settings (public organisation identity)", () => {
  it("defaults: nothing configured, offer workflow required; only an admin can change them; the public endpoint exposes identity only", async () => {
    const pub0 = await app.inject({ method: "GET", url: "/v1/careers/organisation", headers: { "x-tenant-id": TENANT } });
    expect(pub0.json().data).toEqual({ organisationName: null, departmentName: null, emblemUrl: null });
    const hr0 = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-settings", headers: as(U.officer, ["hr_officer"]) });
    expect(hr0.json().data.offerWorkflowRequired).toBe(true);

    const denied = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-settings", headers: { ...as(U.officer, ["hr_officer"]), ...CT }, payload: { organisationName: "X" } });
    expect(denied.statusCode).toBe(403);

    const put = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-settings", headers: { ...as(U.admin, ["hr_admin"]), ...CT },
      payload: { organisationName: "Government of Odisha", departmentName: "H&UD Department", emblemUrl: "https://cdn.example.gov.in/e.png", applicantPurposeNote: "Held 12 months." } });
    expect(put.statusCode).toBe(202);
    await drain();

    const pub = await app.inject({ method: "GET", url: "/v1/careers/organisation", headers: { "x-tenant-id": TENANT } });
    expect(pub.json().data).toEqual({ organisationName: "Government of Odisha", departmentName: "H&UD Department", emblemUrl: "https://cdn.example.gov.in/e.png" });
    expect(pub.body).not.toContain("Held 12 months.");
    const hr = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-settings", headers: as(U.officer, ["hr_officer"]) });
    expect(hr.json().data).toMatchObject({ organisationName: "Government of Odisha", offerWorkflowRequired: true, applicantPurposeNote: "Held 12 months." });
    expect((await audits("recruitment_settings_updated", TENANT)).length).toBeGreaterThan(0);

    const bad = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-settings", headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: { emblemUrl: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);
  });

  it("the settings row is tenant-isolated (another tenant's header sees nothing)", async () => {
    const other = await app.inject({ method: "GET", url: "/v1/careers/organisation", headers: { "x-tenant-id": "00000000-0000-0000-0000-0000000000f9" } });
    expect(other.json().data).toEqual({ organisationName: null, departmentName: null, emblemUrl: null });
  });
});

describe("applicant contact: masked lists and the audited reveal", () => {
  it("the vacancy inbox and the talent pool carry masked contact only; reveal-contact needs a reason, audits, and talent_pool scope needs an admin", async () => {
    const jobId = await createJob();
    const email = `${uniq("pii")}@example.gov.in`;
    const appId = await applyPublic(jobId, email, { category: "SC", dateOfBirth: "1995-03-04" });

    const inbox = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${jobId}/applications`, headers: as(U.officer, ["hr_officer"]) });
    expect(inbox.body).not.toContain(email);
    expect(inbox.body).not.toContain("9876543210");
    const row = (inbox.json().data as Array<Record<string, unknown>>).find((r) => r.id === appId)!;
    expect(row).toMatchObject({ contactMasked: true, mobile: "******3210", category: "sc", hasResume: false });
    expect(String(row.email)).toMatch(/^p\*\*\*@e\*\*\*\.in$/);

    const noReason = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/reveal-contact`, headers: { ...as(U.officer, ["hr_officer"]), ...CT }, payload: {} });
    expect(noReason.statusCode).toBe(400);

    const reveal = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/reveal-contact`, headers: { ...as(U.officer, ["hr_officer"]), ...CT }, payload: { reason: "confirm interview slot by phone" } });
    expect(reveal.statusCode).toBe(200);
    expect(reveal.json().data).toEqual({ id: appId, email, mobile: "9876543210" });
    await drain();
    const logged = await audits("applicant_contact_revealed", appId);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ scope: "inbox", reason: "confirm interview slot by phone", fields: ["email", "mobile"], resourceType: "application" });
    expect(JSON.stringify(logged[0])).not.toContain(email);

    const poolDenied = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/reveal-contact`, headers: { ...as(U.officer, ["hr_officer"]), ...CT }, payload: { reason: "re-engage past applicant", scope: "talent_pool" } });
    expect(poolDenied.statusCode).toBe(403);
    const poolOk = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/reveal-contact`, headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: { reason: "re-engage past applicant", scope: "talent_pool" } });
    expect(poolOk.statusCode).toBe(200);

    const detail = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}`, headers: as(U.admin, ["hr_admin"]) });
    expect(detail.body).not.toContain(email);
    expect(detail.json()).toMatchObject({ contactMasked: true, category: "sc", dateOfBirth: "1995-03-04" });
    const officerView = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}`, headers: as(U.officer, ["hr_officer"]) });
    expect(officerView.json().dateOfBirth).toBeNull(); // DOB stays admin-only
  });

  it("the public apply stores the category in lower case and rejects a future date of birth", async () => {
    const jobId = await createJob();
    const bad = await app.inject({ method: "POST", url: "/v1/careers/apply", headers: CT,
      payload: { tenantId: TENANT, jobOpeningId: jobId, applicantName: "Future Person", email: `${uniq("fut")}@example.gov.in`, consent: true, consentVersion: "2026-10-v1", dateOfBirth: "2099-01-01" } });
    expect(bad.statusCode).toBe(400);
    const appId = await applyPublic(jobId, `${uniq("cat")}@example.gov.in`, { category: "OBC" });
    const [row] = await asTenant((tx) => tx`select category from recruitment.hrms_applications where id = ${appId}`);
    expect(row?.category).toBe("obc");
  });
});

describe("offer approval workflow (DETAIL-05)", () => {
  it("the legacy PATCH shortcut is refused by default; a pay-matrix draft goes through the chain (maker != checker) and release moves the application to 'offered'", async () => {
    const jobId = await createJob();
    const appId = await applyPublic(jobId, `${uniq("off")}@example.gov.in`);
    await shortlist(appId);

    const legacy = await app.inject({ method: "PATCH", url: `/v1/hrms/applications/${appId}/offer`, headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: { ctcMinor: 5_000_000 } });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json().code).toBe("OFFER_WORKFLOW_REQUIRED");

    const created = await app.inject({ method: "POST", url: `/v1/hrms/applications/${appId}/offers`, headers: { ...as(U.admin, ["hr_admin"]), ...CT },
      payload: { basicMinor: 5_610_000, payLevel: 10, payCell: 3, grade: "Gr-B" } });
    expect(created.statusCode).toBe(201);
    const offerId = created.json().id as string;
    await drain();
    const list = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}/offers`, headers: as(U.admin, ["hr_admin"]) });
    expect(list.json().data[0]).toMatchObject({ id: offerId, status: "draft", payLevel: "10", payCell: 3, basicMinor: "5610000", createdBy: U.admin });

    const submit = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/submit`, headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: {} });
    expect(submit.statusCode).toBe(200);
    await drain();

    // the creator cannot approve their own offer, even holding the stage role
    const self = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/approve`, headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: {} });
    expect(self.statusCode).toBe(409);
    expect(self.json().code).toBe("SOD_VIOLATION");

    for (const [who, role] of [[U.hr2, "hr_admin"], [U.fin, "finance_officer"], [U.legal, "legal_officer"], [U.ca, "competent_authority"]] as const) {
      const ok = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/approve`, headers: { ...as(who, [role]), ...CT }, payload: {} });
      expect(ok.statusCode, ok.body).toBe(200);
      await drain();
    }
    const premature = await app.inject({ method: "GET", url: `/v1/hrms/offers/${offerId}`, headers: as(U.admin, ["hr_admin"]) });
    expect(premature.json().status).toBe("approved");

    const release = await app.inject({ method: "POST", url: `/v1/hrms/offers/${offerId}/release`, headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: {} });
    expect(release.statusCode).toBe(200);
    await drain();
    const [stage] = await asTenant((tx) => tx`select stage from recruitment.hrms_applications where id = ${appId}`);
    expect(stage?.stage).toBe("offered");
    const released = await app.inject({ method: "GET", url: `/v1/hrms/offers/${offerId}`, headers: as(U.admin, ["hr_admin"]) });
    expect(released.json().status).toBe("released");
  });
});

describe("horizontal reservations (DETAIL-03)", () => {
  it("persist with the roster, round-trip on GET, are validated against the total, and the approved roster drives the shortlist", async () => {
    const jobId = await createJob(10);
    const tooMany = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${jobId}/reservation-roster`, headers: { ...as(U.admin, ["hr_admin"]), ...CT },
      payload: { totalVacancies: 10, categoryVacancies: { UR: 5, SC: 2, ST: 1, OBC: 1, EWS: 1 }, horizontalVacancies: { PWBD: 11 } } });
    expect(tooMany.statusCode).toBe(422);

    const put = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${jobId}/reservation-roster`, headers: { ...as(U.admin, ["hr_admin"]), ...CT },
      payload: { totalVacancies: 10, categoryVacancies: { UR: 5, SC: 2, ST: 1, OBC: 1, EWS: 1 }, horizontalVacancies: { PWBD: 1, EXSM: 2 } } });
    expect(put.statusCode).toBe(200);
    await drain();
    const get = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${jobId}/reservation-roster`, headers: as(U.admin, ["hr_admin"]) });
    expect(get.json()).toMatchObject({ status: "draft", horizontalVacancies: { PWBD: 1, EXSM: 2 }, categoryVacancies: { EWS: 1 } });

    const sameUser = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${jobId}/reservation-roster/approve`, headers: { ...as(U.admin, ["hr_admin"]), ...CT }, payload: {} });
    expect(sameUser.statusCode).toBe(403);
    const approve = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${jobId}/reservation-roster/approve`, headers: { ...as(U.hr2, ["hr_admin"]), ...CT }, payload: {} });
    expect(approve.statusCode).toBe(200);
    await drain();

    const a = randomUUID(); const b = randomUUID();
    const sl = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${jobId}/reservation-shortlist`, headers: { ...as(U.admin, ["hr_admin"]), ...CT },
      payload: { candidates: [{ applicationId: a, category: "SC", score: 80 }, { applicationId: b, category: "UR", score: 90 }] } });
    expect(sl.statusCode).toBe(200);
    expect(sl.json().selected.map((s: { applicationId: string }) => s.applicationId).sort()).toEqual([a, b].sort());
    const unmapped = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${jobId}/reservation-shortlist`, headers: { ...as(U.admin, ["hr_admin"]), ...CT },
      payload: { candidates: [{ applicationId: a, category: "PH", score: 80 }] } });
    expect(unmapped.statusCode).toBe(422);
  });
});
