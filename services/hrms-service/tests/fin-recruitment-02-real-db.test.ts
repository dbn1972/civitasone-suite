/**
 * fin-recruitment-02 -- real-Postgres regression suite:
 *  - NEW-06: per-edition policy; Govt = requisition-first (direct POST /job-openings and the JD-template
 *    "use" path are refused with 409 REQUISITION_REQUIRED), Small Office = unchanged, override honoured,
 *    requisition publish still creates a vacancy, policy is tenant-scoped and admin-only to change.
 *  - HOME-05: advertisement number set via PATCH /advertisement, listed on the hub payload, unique per tenant,
 *    clearable, locked once published.
 *  - APPLICATION-06: GET /applications/:id/scorecards with the blind-scoring rule and resolved interviewer names.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
import { COMMANDS } from "../src/topics.js";
import { registerF3_manpower_planning_Consumers } from "../src/modules/manpower-planning/f3-consumer.js";
import { seedHrmsCoreFixtures } from "./fixtures/core-seed.js";

// The tenant's edition normally comes from tenant-service; tests set it here ("undefined" == unreadable).
const tenantEdition = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("../src/shared/tenant-client.js", () => ({
  fetchTenantEdition: async () => tenantEdition.value,
  resetTenantEditionCache: () => undefined,
}));

// Capture every enqueue() so the audit events emitted by the consumers can be asserted.
const enqueued = vi.hoisted(() => [] as Array<{ topic: string; payload: Record<string, unknown> }>);
vi.mock("../src/shared/outbox.js", async (io) => {
  const actual = await io<Record<string, unknown>>();
  const realEnqueue = actual.enqueue as (tx: unknown, m: { topic: string; payload: Record<string, unknown> }) => Promise<unknown>;
  return { ...actual, enqueue: async (tx: unknown, m: { topic: string; payload: Record<string, unknown> }) => { enqueued.push({ topic: m.topic, payload: m.payload }); return realEnqueue(tx, m); } };
});

registerRecruitmentConsumers(queue);
registerF3_recruitment_Consumers(queue);
registerF3_manpower_planning_Consumers(queue);
async function drain(): Promise<void> {
  await (queue as unknown as MemoryQueue).drain();
}

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000f8";
const HR = "aaaaaaaa-e2e2-4000-8000-000000000011";
const DEPT = "eeeeeeee-0001-0000-0000-000000000001";
const DESIG = "eeeeeeee-0001-0000-0000-000000000003";
const CT = { "content-type": "application/json" };
const auth = (roles: string[] = ["hr_admin"], tid = TENANT, sub = HR) => ({ authorization: `Bearer ${signToken({ sub, tid, roles, sid: "s" }, SECRET)}` });
const uniq = (l: string) => `${l}-${randomUUID().slice(0, 8)}`;

let app: FastifyInstance;
let db: postgres.Sql;

async function asTenant<T>(fn: (tx: postgres.TransactionSql) => Promise<T>, tid = TENANT): Promise<T> {
  return db.begin(async (tx) => {
    await tx.unsafe(`select set_config('app.tenant_id', '${tid}', true)`);
    return fn(tx);
  });
}

beforeAll(async () => {
  await seedHrmsCoreFixtures();
  db = postgres(process.env.DATABASE_URL ?? "postgres://hrms_svc:hrms_dev_pw@localhost:5435/civitas_hrms", { max: 5 });
  app = await buildApp();
});

afterAll(async () => {
  await asTenant((tx) => tx`DELETE FROM recruitment.hrms_recruitment_edition_policy WHERE tenant_id = ${TENANT}`);
  await app.close();
  await db.end({ timeout: 5 });
  await sqlClient.end();
});

async function setPolicy(edition: string, requireRequisition?: boolean | null, roles = ["hr_admin"]) {
  const r = await app.inject({
    method: "PUT", url: "/v1/hrms/recruitment-policy", headers: { ...auth(roles), ...CT },
    payload: requireRequisition === undefined ? { edition } : { edition, requireRequisition },
  });
  await drain();
  return r;
}
const directCreate = (extra: Record<string, unknown> = {}) => app.inject({
  method: "POST", url: "/v1/hrms/job-openings", headers: { ...auth(), ...CT },
  payload: { refNo: uniq("F2"), title: "FR02 Role", departmentId: DEPT, vacancies: 1, ...extra },
});
async function createJob(extra: Record<string, unknown> = {}): Promise<string> {
  const r = await directCreate(extra);
  expect(r.statusCode).toBe(202);
  const id = r.json().id as string;
  await drain();
  return id;
}

describe("NEW-06 -- per-edition requisition-first vacancy creation", () => {
  it("with no policy row (Small Office default) direct creation still works", async () => {
    await asTenant((tx) => tx`DELETE FROM recruitment.hrms_recruitment_edition_policy WHERE tenant_id = ${TENANT}`);
    const g = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-policy", headers: auth() });
    expect(g.json()).toMatchObject({ edition: "small_office", requireRequisition: null, requisitionRequired: false, source: "default" });
    await createJob();
  });

  it("Govt edition: POST /job-openings is refused server-side (409 REQUISITION_REQUIRED) and nothing is created", async () => {
    expect((await setPolicy("govt")).statusCode).toBe(202);
    const g = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-policy", headers: auth() });
    expect(g.json()).toMatchObject({ edition: "govt", requireRequisition: null, requisitionRequired: true, source: "row" });
    const refNo = uniq("BLOCKED");
    const r = await directCreate({ refNo });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("REQUISITION_REQUIRED");
    await drain();
    const rows = await asTenant((tx) => tx`SELECT 1 FROM recruitment.hrms_job_openings WHERE ref_no = ${refNo}`);
    expect(rows).toHaveLength(0);
  });

  it("Govt edition: the JD-template 'use' path (another direct-create route) is refused too", async () => {
    await setPolicy("govt");
    const r = await app.inject({ method: "POST", url: `/v1/hrms/jd-templates/${randomUUID()}/use`, headers: { ...auth(), ...CT }, payload: { departmentId: DEPT } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("REQUISITION_REQUIRED");
  });

  it("Govt edition: an approved requisition can still be published into a vacancy", async () => {
    await setPolicy("govt");
    const reqId = randomUUID();
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_requisitions
        (id, tenant_id, requisition_no, title, department_id, designation_id, vacancies, status, approved_at, created_by, updated_by)
      VALUES (${reqId}, ${TENANT}, ${uniq("REQ")}, 'Govt requisition', ${DEPT}, ${DESIG}, 2, 'approved', now(), ${HR}, ${HR})`);
    const r = await app.inject({ method: "POST", url: `/v1/hrms/requisitions/${reqId}/publish`, headers: { ...auth(), ...CT }, payload: {} });
    expect(r.statusCode).toBe(200);
    const openingId = r.json().publishedOpeningId as string;
    await drain();
    const rows = await asTenant((tx) => tx`SELECT id FROM recruitment.hrms_job_openings WHERE id = ${openingId}`);
    expect(rows).toHaveLength(1);
  });

  it("an unapproved requisition cannot be published under the Govt policy (gate not bypassed)", async () => {
    await setPolicy("govt");
    const reqId = randomUUID();
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_requisitions (id, tenant_id, requisition_no, title, department_id, status, created_by, updated_by)
      VALUES (${reqId}, ${TENANT}, ${uniq("REQ")}, 'Draft one', ${DEPT}, 'pending_approval', ${HR}, ${HR})`);
    const r = await app.inject({ method: "POST", url: `/v1/hrms/requisitions/${reqId}/publish`, headers: { ...auth(), ...CT }, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_APPROVED");
  });

  it("explicit override: Small Office + requireRequisition=true is blocked; Govt + requireRequisition=false is allowed", async () => {
    await setPolicy("small_office", true);
    expect((await directCreate()).statusCode).toBe(409);
    await setPolicy("govt", false);
    const g = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-policy", headers: auth() });
    expect(g.json()).toMatchObject({ edition: "govt", requireRequisition: false, requisitionRequired: false });
    await createJob();
  });

  it("switching back to Small Office re-opens direct creation", async () => {
    await setPolicy("govt");
    expect((await directCreate()).statusCode).toBe(409);
    await setPolicy("small_office", null);
    await createJob();
  });

  it("only hr_admin / super_admin may change the policy; hr_officer and invalid editions are rejected", async () => {
    expect((await setPolicy("govt", undefined, ["hr_officer"])).statusCode).toBe(403);
    const bad = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-policy", headers: { ...auth(), ...CT }, payload: { edition: "enterprise" } });
    expect(bad.statusCode).toBe(400);
  });

  it("the policy is tenant-scoped: another tenant's Govt policy does not block this tenant", async () => {
    await setPolicy("small_office", null);
    await asTenant((tx) => tx`
      INSERT INTO recruitment.hrms_recruitment_edition_policy (tenant_id, edition, updated_by) VALUES (${OTHER_TENANT}, 'govt', ${HR})
      ON CONFLICT (tenant_id) DO UPDATE SET edition = 'govt'`, OTHER_TENANT);
    await createJob();
    const other = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-policy", headers: auth(["hr_admin"], OTHER_TENANT) });
    expect(other.json().requisitionRequired).toBe(true);
    await asTenant((tx) => tx`DELETE FROM recruitment.hrms_recruitment_edition_policy WHERE tenant_id = ${OTHER_TENANT}`, OTHER_TENANT);
  });

  it("every change is audited with before/after", async () => {
    await setPolicy("small_office", null);
    enqueued.length = 0;
    await setPolicy("govt");
    const ev = enqueued.find((e) => e.topic === "audit.event.record" && e.payload.resourceType === "recruitment_edition_policy");
    expect(ev).toBeDefined();
    expect((ev!.payload.before as { edition: string }).edition).toBe("small_office");
    expect((ev!.payload.after as { edition: string }).edition).toBe("govt");
    await setPolicy("small_office", null);
  });
});

describe("NEW-06 -- default derived from the real tenant edition (no policy row)", () => {
  const noRow = () => asTenant((tx) => tx`DELETE FROM recruitment.hrms_recruitment_edition_policy WHERE tenant_id = ${TENANT}`);
  afterAll(() => { tenantEdition.value = undefined; });

  it.each(["govt", "govt_dept", "GOVT"])("tenant edition %s => requisition-first ON (direct create 409, GET says tenant_edition)", async (ed) => {
    await noRow();
    tenantEdition.value = ed;
    expect((await directCreate()).statusCode).toBe(409);
    const g = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-policy", headers: auth() });
    expect(g.json()).toMatchObject({ requisitionRequired: true, source: "tenant_edition", edition: "govt" });
  });

  it.each(["psu", "private", "ngo", "section8", "cooperative", "small_office"])("tenant edition %s => OFF (direct create allowed)", async (ed) => {
    await noRow();
    tenantEdition.value = ed;
    await createJob();
    const g = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-policy", headers: auth() });
    expect(g.json()).toMatchObject({ requisitionRequired: false, source: "tenant_edition" });
  });

  it.each([undefined, "mystery_edition", ""])("unknown or unreadable edition (%s) fails closed to OFF", async (ed) => {
    await noRow();
    tenantEdition.value = ed;
    await createJob();
    const g = await app.inject({ method: "GET", url: "/v1/hrms/recruitment-policy", headers: auth() });
    expect(g.json()).toMatchObject({ requisitionRequired: false, source: "default" });
  });

  it("the JD-template path follows the derived default too", async () => {
    await noRow();
    tenantEdition.value = "govt_dept";
    const r = await app.inject({ method: "POST", url: `/v1/hrms/jd-templates/${randomUUID()}/use`, headers: { ...auth(), ...CT }, payload: { departmentId: DEPT } });
    expect(r.statusCode).toBe(409);
  });

  it("an explicit stored policy (row) wins over the tenant edition, both ways", async () => {
    tenantEdition.value = "govt";
    await setPolicy("small_office", null);
    await createJob();                                  // row says small_office although tenant edition is govt
    await setPolicy("govt", false);
    await createJob();                                  // explicit override false wins
    tenantEdition.value = "small_office";
    await setPolicy("small_office", true);
    expect((await directCreate()).statusCode).toBe(409); // explicit override true wins
    await noRow();
  });
});

describe("HOME-05 -- advertisement number", () => {
  it("is set via PATCH /advertisement, appears on the hub list, and can be cleared", async () => {
    await setPolicy("small_office", null);
    const id = await createJob();
    const advt = uniq("Advt-03/2026");
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${id}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: advt } });
    expect(r.statusCode).toBe(200);
    await drain();
    const list = await app.inject({ method: "GET", url: "/v1/hrms/job-openings?limit=200", headers: auth() });
    const row = (list.json() as Array<{ id: string; advertisementNo: string | null }>).find((x) => x.id === id);
    expect(row?.advertisementNo).toBe(advt);
    const ad = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${id}/advertisement`, headers: auth() });
    expect(ad.json().advertisementNo).toBe(advt);

    await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${id}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: null } });
    await drain();
    const after = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${id}/advertisement`, headers: auth() });
    expect(after.json().advertisementNo).toBeNull();
  });

  it("is unique per tenant, case-insensitively (409), but reusable by the same vacancy", async () => {
    const a = await createJob();
    const b = await createJob();
    const advt = uniq("Advt-DUP");
    await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${a}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: advt } });
    await drain();
    const dup = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${b}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: advt.toLowerCase() } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_ADVERTISEMENT_NO");
    const same = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${a}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: advt } });
    expect(same.statusCode).toBe(200);
    await drain();
  });

  it("the DB itself rejects a duplicate (unique index backstop) and an empty number is a 400", async () => {
    const a = await createJob();
    const b = await createJob();
    const advt = uniq("Advt-IDX");
    await asTenant((tx) => tx`UPDATE recruitment.hrms_job_openings SET advertisement_no = ${advt} WHERE id = ${a}`);
    await expect(asTenant((tx) => tx`UPDATE recruitment.hrms_job_openings SET advertisement_no = ${advt.toUpperCase()} WHERE id = ${b}`)).rejects.toThrow(/ux_hrms_job_openings_advt_no/);
    const empty = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${b}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: "   " } });
    expect(empty.statusCode).toBe(400);
  });

  it("consumer: a 23505 from the unique index is a TERMINAL, audited failure (no throw, no retry, nothing written)", async () => {
    tenantEdition.value = undefined;
    const a = await createJob();
    const b = await createJob();
    const advt = uniq("Advt-RACE");
    await asTenant((tx) => tx`UPDATE recruitment.hrms_job_openings SET advertisement_no = ${advt} WHERE id = ${a}`);
    enqueued.length = 0;
    // Bypass the route pre-check, exactly as the losing side of a race does.
    await queue.publish(COMMANDS.f3RouteWrite, {
      messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT, actorId: HR, correlationId: randomUUID(), schemaVersion: "1.0",
      payload: { op: "recruitment_publication_routes__0", id: b, tenantId: TENANT, body: { advertisementNo: advt }, params: { id: b }, query: {} },
    } as never);
    await expect(drain()).resolves.toBeUndefined();
    const rows = await asTenant((tx) => tx`SELECT id, advertisement_no FROM recruitment.hrms_job_openings WHERE id IN (${a}, ${b})`);
    expect(rows.find((r) => r.id === b)?.advertisement_no).toBeNull();
    expect(rows.find((r) => r.id === a)?.advertisement_no).toBe(advt);
    const ev = enqueued.find((e) => e.topic === "audit.event.record" && e.payload.resourceType === "job_opening_advertisement");
    expect(ev?.payload).toMatchObject({ outcome: "failure", reason: "DUPLICATE_ADVERTISEMENT_NO", resourceId: b, advertisementNo: advt });
  });

  it("two concurrent PATCHes with the same number: exactly one vacancy ends up with it and the loser is rejected or audited, never lost silently", async () => {
    const a = await createJob();
    const b = await createJob();
    const advt = uniq("Advt-CONC");
    enqueued.length = 0;
    const [ra, rb] = await Promise.all([a, b].map((id) => app.inject({
      method: "PATCH", url: `/v1/hrms/job-openings/${id}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: advt },
    })));
    await drain();
    const holders = await asTenant((tx) => tx`SELECT id FROM recruitment.hrms_job_openings WHERE lower(advertisement_no) = lower(${advt})`);
    expect(holders).toHaveLength(1);
    const statuses = [ra!.statusCode, rb!.statusCode].sort();
    const audited = enqueued.some((e) => e.payload.resourceType === "job_opening_advertisement" && e.payload.outcome === "failure");
    // Either the route pre-check rejected the loser (409) or it raced through and the consumer audited the failure.
    expect(statuses[0] === 200 && (statuses[1] === 409 || audited)).toBe(true);
  });

  it("is locked once the vacancy is published (corrigendum instead)", async () => {
    const id = await createJob();
    await asTenant((tx) => tx`UPDATE recruitment.hrms_job_openings SET is_published = true WHERE id = ${id}`);
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${id}/advertisement`, headers: { ...auth(), ...CT }, payload: { advertisementNo: uniq("LATE") } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ADVERTISEMENT_LOCKED");
  });
});

describe("APPLICATION-06 -- interview scorecards on the application", () => {
  const P1 = "bbbbbbbb-0000-4000-8000-000000000001";
  const P2 = "bbbbbbbb-0000-4000-8000-000000000002";
  const TEMPLATE = [{ competency: "technical", weight: 60, maxScore: 10 }, { competency: "communication", weight: 40, maxScore: 10 }];

  async function seed(): Promise<{ appId: string; ivId: string }> {
    const jobId = await createJob();
    const appId = randomUUID();
    const ivId = randomUUID();
    await asTenant(async (tx) => {
      await tx`INSERT INTO employee.hrms_employees (id, tenant_id, employee_no, full_name, department_id, designation_id, date_of_joining, user_ref, created_by, updated_by)
        VALUES (${randomUUID()}, ${TENANT}, ${uniq("E")}, 'Asha Panelist', ${DEPT}, ${DESIG}, '2020-01-01', ${P1}, ${HR}, ${HR})
        ON CONFLICT DO NOTHING`;
      await tx`INSERT INTO recruitment.hrms_applications (id, tenant_id, job_opening_id, applicant_name, created_by, updated_by)
        VALUES (${appId}, ${TENANT}, ${jobId}, 'Candidate One', ${HR}, ${HR})`;
      await tx`INSERT INTO recruitment.hrms_interviews (id, tenant_id, application_id, job_opening_id, scheduled_date, scheduled_time, panel_members, scorecard_template, cutoff_score, panel_score, recommendation, consolidated_at, created_by)
        VALUES (${ivId}, ${TENANT}, ${appId}, ${jobId}, '2026-10-01', '10:00', ${JSON.stringify([P1, P2])}::jsonb, ${JSON.stringify(TEMPLATE)}::jsonb, 60, 72, 'recommend', now(), ${HR})`;
      await tx`INSERT INTO recruitment.hrms_interview_scores (tenant_id, interview_id, interviewer_id, scores, overall_score, comments, submitted, submitted_at)
        VALUES (${TENANT}, ${ivId}, ${P1}, ${JSON.stringify({ technical: 8, communication: 7 })}::jsonb, 76, 'Strong', true, now()),
               (${TENANT}, ${ivId}, ${P2}, ${JSON.stringify({ technical: 6, communication: 7 })}::jsonb, 66, 'Fair', true, now())`;
    });
    return { appId, ivId };
  }

  it("an HR reviewer who is not on the panel sees every submitted score, the consolidated result, and names (never ids)", async () => {
    const { appId, ivId } = await seed();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}/scorecards`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    const [card] = r.json().data as Array<Record<string, unknown> & { scores: Array<{ interviewer: string }> }>;
    expect(card!.interviewId).toBe(ivId);
    expect(card!.blinded).toBe(false);
    expect(card!.panelScore).toBe(72);
    expect(card!.recommendation).toBe("recommend");
    expect(card!.scores).toHaveLength(2);
    const who = card!.scores.map((s) => s.interviewer);
    expect(who).toContain("Asha Panelist");
    expect(who).toContain("Panel member 2"); // P2 has no employee row -> anonymous label (numbered over sorted ids, P1 < P2), not a UUID
    expect(JSON.stringify(r.json())).not.toContain(P2);
  });

  it("blind scoring (R-RA-0147): a panelist who has NOT submitted sees no scores, no panel score, no recommendation", async () => {
    const { appId, ivId } = await seed();
    await asTenant((tx) => tx`DELETE FROM recruitment.hrms_interview_scores WHERE interview_id = ${ivId} AND interviewer_id = ${P1}`);
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}/scorecards`, headers: auth(["hr_officer"], TENANT, P1) });
    const [card] = r.json().data as Array<{ blinded: boolean; scores: unknown[]; panelScore: number | null; recommendation: string | null; submittedCount: number }>;
    expect(card!.blinded).toBe(true);
    expect(card!.scores).toHaveLength(0);
    expect(card!.panelScore).toBeNull();
    expect(card!.recommendation).toBeNull();
    expect(card!.submittedCount).toBe(1);
  });

  it("a panelist who HAS submitted sees the whole panel", async () => {
    const { appId } = await seed();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}/scorecards`, headers: auth(["hr_officer"], TENANT, P1) });
    const [card] = r.json().data as Array<{ blinded: boolean; scores: unknown[] }>;
    expect(card!.blinded).toBe(false);
    expect(card!.scores).toHaveLength(2);
  });

  it("an application with no interviews returns an empty list; unknown / foreign-tenant ids are 404; non-HR roles are 403", async () => {
    const jobId = await createJob();
    const appId = randomUUID();
    await asTenant((tx) => tx`INSERT INTO recruitment.hrms_applications (id, tenant_id, job_opening_id, applicant_name, created_by, updated_by) VALUES (${appId}, ${TENANT}, ${jobId}, 'No Interviews', ${HR}, ${HR})`);
    const empty = await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}/scorecards`, headers: auth() });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().data).toEqual([]);
    expect((await app.inject({ method: "GET", url: `/v1/hrms/applications/${randomUUID()}/scorecards`, headers: auth() })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}/scorecards`, headers: auth(["hr_admin"], OTHER_TENANT) })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/v1/hrms/applications/${appId}/scorecards`, headers: auth(["employee"]) })).statusCode).toBe(403);
  });
});
