/**
 * fin-recruitment-01 route contracts (in-process Fastify, repos mocked):
 *  - GAP-RECRUITMENT-DETAIL-08 / TALENT-POOL-02: audited, role-gated, fail-closed contact reveal
 *  - GAP-RECRUITMENT-CAREERS-HOME-02 / PORTAL-LOGIN-02: public organisation identity, admin-only settings
 *  - GAP-RECRUITMENT-DETAIL-05: legacy single-field offer is refused while the approval workflow is required
 *  - GAP-RECRUITMENT-DETAIL-03: horizontal reservation validation on the roster
 *  - GAP-RECRUITMENT-DETAIL-14: admit card
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";

const TENANT = "aaaaaaaa-0001-4000-8000-00000000a001";
const APP_ID = "11111111-0001-4000-8000-000000000001";
const JOB_ID = "22222222-0001-4000-8000-000000000002";
const ATTEMPT = "33333333-0001-4000-8000-000000000003";
const SCHEDULE = "44444444-0001-4000-8000-000000000004";

const H = vi.hoisted(() => ({
  ctx: { tenantId: "aaaaaaaa-0001-4000-8000-00000000a001", actorId: "99999999-0001-4000-8000-000000000009", correlationId: "c-1", roles: ["hr_admin"] as string[] },
  publish: vi.fn(async () => ({ id: "x", status: "accepted" })),
  findApplication: vi.fn(),
  getSettings: vi.fn(),
  findAttempt: vi.fn(),
  findSchedule: vi.fn(),
  listAttemptsBySchedule: vi.fn(),
  findCandidate: vi.fn(),
  findByJob: vi.fn(),
  presign: vi.fn(async () => "https://signed.example/resume"),
  offerApplication: vi.fn(async () => ({ id: "o", status: "accepted", correlationId: "c" })),
  findApplicationById: vi.fn(),
  listForVacancy: vi.fn(),
  maxOfferVersion: vi.fn(async () => 0),
}));

vi.mock("../src/shared/context.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  resolveContext: () => H.ctx,
}));
vi.mock("../src/shared/f3-publish.js", () => ({ publishF3Write: (...a: unknown[]) => (H.publish as (...x: unknown[]) => unknown)(...a) }));
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findApplication(...a),
  listApplicationsForVacancy: (...a: unknown[]) => H.listForVacancy(...a),
}));
vi.mock("../src/modules/recruitment/settings-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  getSettings: (...a: unknown[]) => H.getSettings(...a),
}));
vi.mock("../src/modules/recruitment/attempt-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findAttempt: (...a: unknown[]) => H.findAttempt(...a),
  findSchedule: (...a: unknown[]) => H.findSchedule(...a),
  listAttemptsBySchedule: (...a: unknown[]) => H.listAttemptsBySchedule(...a),
}));
vi.mock("../src/modules/recruitment/candidate-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findCandidate: (...a: unknown[]) => H.findCandidate(...a),
}));
vi.mock("../src/modules/recruitment/reservation-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findByJob: (...a: unknown[]) => H.findByJob(...a),
}));
vi.mock("../src/modules/recruitment/repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplicationById: (...a: unknown[]) => H.findApplicationById(...a),
}));
vi.mock("../src/shared/audit.js", () => ({ writeAuditLog: async () => undefined }));
vi.mock("../src/modules/recruitment/offer-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findApplication(...a),
  maxOfferVersion: (...a: unknown[]) => H.maxOfferVersion(...a),
}));
vi.mock("../src/modules/recruitment/commands.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  offerApplication: (...a: unknown[]) => (H.offerApplication as (...x: unknown[]) => unknown)(...a),
}));
vi.mock("@civitasone/storage", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  presignedGetUrl: (...a: unknown[]) => (H.presign as (...x: unknown[]) => unknown)(...a),
}));

import { piiRevealRoutes } from "../src/modules/recruitment/pii-reveal-routes.js";
import { recruitmentSettingsRoutes } from "../src/modules/recruitment/settings-routes.js";
import { recruitmentRoutes } from "../src/modules/recruitment/routes.js";
import { reservationRoutes } from "../src/modules/recruitment/reservation-routes.js";
import { admitCardRoutes } from "../src/modules/recruitment/admit-card-routes.js";
import { offerRoutes } from "../src/modules/recruitment/offer-routes.js";
import { assessmentAttemptRoutes } from "../src/modules/recruitment/attempt-routes.js";

async function appWith(plugin: (a: import("fastify").FastifyInstance) => Promise<void>) {
  const app = Fastify();
  await app.register(plugin);
  return app;
}
const APPLICATION = { id: APP_ID, tenantId: TENANT, jobOpeningId: JOB_ID, applicantName: "Asha Verma", applicationNo: "APP-2026-000042", email: "asha@example.com", mobile: "9876543210", resumeFileKey: null, screeningDecision: "shortlisted" };

beforeEach(() => {
  vi.clearAllMocks();
  H.ctx.roles = ["hr_admin"];
  H.findApplication.mockResolvedValue(APPLICATION);
  H.getSettings.mockResolvedValue({ organisationName: null, departmentName: null, emblemUrl: null, offerWorkflowRequired: true, applicantPurposeNote: null });
});

describe("POST /v1/hrms/applications/:id/reveal-contact (audited PII reveal)", () => {
  it("records the audit op first and then returns the full contact details; the audit body carries no PII", async () => {
    H.ctx.roles = ["hr_officer"];
    const order: string[] = [];
    H.publish.mockImplementationOnce(async () => { order.push("audit"); return { id: "x", status: "accepted" }; });
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/reveal-contact`, payload: { reason: "verify mobile before interview call", scope: "inbox" } });
    order.push("response");
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ id: APP_ID, email: "asha@example.com", mobile: "9876543210" });
    expect(order).toEqual(["audit", "response"]);
    const [, op, , payload] = H.publish.mock.calls[0] as unknown as [unknown, string, string, { body: Record<string, unknown>; params: Record<string, unknown> }];
    expect(op).toBe("recruitment_pii_reveal__0");
    expect(payload.params).toEqual({ id: APP_ID });
    expect(payload.body).toMatchObject({ action: "applicant_contact_revealed", scope: "inbox", reason: "verify mobile before interview call" });
    expect(JSON.stringify(payload)).not.toContain("asha@example.com");
    expect(JSON.stringify(payload)).not.toContain("9876543210");
    await app.close();
  });

  it("FAILS CLOSED: when the audit event cannot be queued nothing is revealed", async () => {
    H.publish.mockRejectedValueOnce(new Error("queue down"));
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/reveal-contact`, payload: { reason: "needed for follow-up" } });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain("asha@example.com");
    expect(res.body).not.toContain("9876543210");
    await app.close();
  });

  it("requires a stated reason", async () => {
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/reveal-contact`, payload: { reason: "x" } });
    expect(res.statusCode).toBe(400);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });

  it("403s a non-HR role and never audits", async () => {
    H.ctx.roles = ["employee"];
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/reveal-contact`, payload: { reason: "curious about this person" } });
    expect(res.statusCode).toBe(403);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });

  it("talent-pool scope is limited to hr_admin / super_admin (an hr_officer is refused)", async () => {
    H.ctx.roles = ["hr_officer"];
    const app = await appWith(piiRevealRoutes);
    const denied = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/reveal-contact`, payload: { reason: "re-engage past applicant", scope: "talent_pool" } });
    expect(denied.statusCode).toBe(403);
    expect(H.publish).not.toHaveBeenCalled();
    H.ctx.roles = ["hr_admin"];
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/reveal-contact`, payload: { reason: "re-engage past applicant", scope: "talent_pool" } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("404s an unknown application without auditing", async () => {
    H.findApplication.mockResolvedValue(null);
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/reveal-contact`, payload: { reason: "needed for follow-up" } });
    expect(res.statusCode).toBe(404);
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });
});

describe("GET /v1/hrms/applications/:id/resume-link", () => {
  it("404s when the applicant uploaded no resume", async () => {
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}/resume-link` });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("refuses a stored key outside this tenant's careers-resume namespace", async () => {
    H.findApplication.mockResolvedValue({ ...APPLICATION, resumeFileKey: "careers-resumes/other-tenant/abc.pdf" });
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}/resume-link` });
    expect(res.statusCode).toBe(404);
    expect(H.presign).not.toHaveBeenCalled();
    await app.close();
  });

  it("audits and returns a short-lived link for a valid key", async () => {
    H.findApplication.mockResolvedValue({ ...APPLICATION, resumeFileKey: `careers-resumes/${TENANT}/5f1c2d3e-0001-4000-8000-000000000001.pdf` });
    const app = await appWith(piiRevealRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}/resume-link` });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ url: "https://signed.example/resume", expiresInSeconds: 300 });
    expect(H.publish).toHaveBeenCalledTimes(1);
    expect((H.publish.mock.calls[0] as unknown as [unknown, string, string, { body: { action: string } }])[3].body.action).toBe("applicant_resume_viewed");
    await app.close();
  });
});

describe("recruitment settings routes", () => {
  it("the PUBLIC organisation endpoint exposes only the identity fields", async () => {
    H.getSettings.mockResolvedValue({ organisationName: "Government of Odisha", departmentName: "H&UD Department", emblemUrl: "https://cdn.example/emblem.png", offerWorkflowRequired: true, applicantPurposeNote: "internal note" });
    const app = await appWith(recruitmentSettingsRoutes);
    const res = await app.inject({ method: "GET", url: "/v1/careers/organisation", headers: { "x-tenant-id": TENANT } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data).toEqual({ organisationName: "Government of Odisha", departmentName: "H&UD Department", emblemUrl: "https://cdn.example/emblem.png" });
    expect(res.body).not.toContain("internal note");
    expect(res.body).not.toContain("offerWorkflowRequired");
    await app.close();
  });

  it("the public endpoint needs a tenant", async () => {
    const app = await appWith(recruitmentSettingsRoutes);
    const res = await app.inject({ method: "GET", url: "/v1/careers/organisation" });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("PUT is admin-only, validated (no javascript: emblem) and queued", async () => {
    const app = await appWith(recruitmentSettingsRoutes);
    H.ctx.roles = ["hr_officer"];
    const denied = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-settings", payload: { organisationName: "X" } });
    expect(denied.statusCode).toBe(403);
    H.ctx.roles = ["hr_admin"];
    const bad = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-settings", payload: { emblemUrl: "javascript:alert(1)" } });
    expect(bad.statusCode).toBe(400);
    const empty = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-settings", payload: {} });
    expect(empty.statusCode).toBe(400);
    expect(H.publish).not.toHaveBeenCalled();
    const ok = await app.inject({ method: "PUT", url: "/v1/hrms/recruitment-settings", payload: { organisationName: "Government of Odisha", offerWorkflowRequired: false } });
    expect(ok.statusCode).toBe(202);
    expect((H.publish.mock.calls[0] as unknown as [unknown, string])[1]).toBe("recruitment_settings_routes__0");
    await app.close();
  });
});

describe("PATCH /v1/hrms/applications/:id/offer (legacy shortcut)", () => {
  const body = { ctcMinor: 5_610_050, currency: "INR" };
  beforeEach(() => { H.findApplicationById.mockResolvedValue({ id: APP_ID, stage: "shortlisted", status: "active" }); });

  it("is refused with OFFER_WORKFLOW_REQUIRED by default (no approval chain would run)", async () => {
    const app = await appWith(recruitmentRoutes);
    const res = await app.inject({ method: "PATCH", url: `/v1/hrms/applications/${APP_ID}/offer`, payload: body });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("OFFER_WORKFLOW_REQUIRED");
    expect(H.offerApplication).not.toHaveBeenCalled();
    await app.close();
  });

  it("still works when the tenant has switched the workflow requirement off", async () => {
    H.getSettings.mockResolvedValue({ organisationName: null, departmentName: null, emblemUrl: null, offerWorkflowRequired: false, applicantPurposeNote: null });
    const app = await appWith(recruitmentRoutes);
    const res = await app.inject({ method: "PATCH", url: `/v1/hrms/applications/${APP_ID}/offer`, payload: body });
    expect(res.statusCode).toBe(202);
    expect(H.offerApplication).toHaveBeenCalledTimes(1);
    await app.close();
  });
});

describe("POST /v1/hrms/applications/:id/offers (pay level / cell)", () => {
  it("rejects a pay level without a cell", async () => {
    const app = await appWith(offerRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/offers`, payload: { basicMinor: 5_610_000, payLevel: 10 } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("PAY_LEVEL_AND_CELL");
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a pay level outside 1-18", async () => {
    const app = await appWith(offerRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/offers`, payload: { basicMinor: 5_610_000, payLevel: 19, payCell: 1 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });

  it("queues a draft offer carrying the pay-matrix coordinates", async () => {
    const app = await appWith(offerRoutes);
    const res = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP_ID}/offers`, payload: { basicMinor: 5_610_000, payLevel: 10, payCell: 3 } });
    expect(res.statusCode).toBe(201);
    const [, op, , payload] = H.publish.mock.calls[0] as unknown as [unknown, string, string, { body: Record<string, unknown> }];
    expect(op).toBe("recruitment_offer_routes__0");
    expect(payload.body).toMatchObject({ payLevel: 10, payCell: 3 });
    await app.close();
  });
});

describe("reservation roster: horizontal reservations", () => {
  const base = { totalVacancies: 10, categoryVacancies: { UR: 5, SC: 2, ST: 1, OBC: 1, EWS: 1 } };
  beforeEach(() => { H.findByJob.mockResolvedValue(null); });

  it("accepts EWS and horizontal PwBD / ex-servicemen counts and forwards them to the consumer", async () => {
    const app = await appWith(reservationRoutes);
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${JOB_ID}/reservation-roster`, payload: { ...base, horizontalVacancies: { PWBD: 1, EXSM: 2 } } });
    expect(res.statusCode).toBe(200);
    expect((H.publish.mock.calls[0] as unknown as [unknown, string, string, { body: Record<string, unknown> }])[3].body.horizontalVacancies).toEqual({ PWBD: 1, EXSM: 2 });
    await app.close();
  });

  it("rejects a horizontal count larger than the total posts", async () => {
    const app = await appWith(reservationRoutes);
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${JOB_ID}/reservation-roster`, payload: { ...base, horizontalVacancies: { PWBD: 11 } } });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_ROSTER");
    expect(H.publish).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a vertical category that is not in the roster domain (PwBD is horizontal, not vertical)", async () => {
    const app = await appWith(reservationRoutes);
    const res = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${JOB_ID}/reservation-roster`, payload: { totalVacancies: 10, categoryVacancies: { UR: 5, SC: 2, ST: 1, OBC: 1, PH: 1 } } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

describe("GET /v1/hrms/assessments/attempts/:id/admit-card", () => {
  const attempt = { id: ATTEMPT, scheduleId: SCHEDULE, candidateId: "55555555-0001-4000-8000-000000000005", applicationId: APP_ID, status: "assigned", slotLabel: "Slot A", identityVerified: false };
  const schedule = { id: SCHEDULE, title: "Written Test - Assistant", mode: "online", status: "scheduled", windowStart: new Date("2026-10-20T04:30:00Z"), windowEnd: new Date("2026-10-20T07:30:00Z") };
  beforeEach(() => { H.findAttempt.mockResolvedValue(attempt); H.findSchedule.mockResolvedValue(schedule); });

  it("returns the card with a stable derived roll number and instructions", async () => {
    const app = await appWith(admitCardRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/assessments/attempts/${ATTEMPT}/admit-card` });
    expect(res.statusCode).toBe(200);
    const d = res.json().data;
    expect(d).toMatchObject({ rollNumber: "4444-333333", candidateName: "Asha Verma", applicationNo: "APP-2026-000042", examination: "Written Test - Assistant", slotLabel: "Slot A" });
    expect(d.instructions.length).toBeGreaterThan(0);
    await app.close();
  });

  it("409s a cancelled sitting", async () => {
    H.findSchedule.mockResolvedValue({ ...schedule, status: "cancelled" });
    const app = await appWith(admitCardRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/assessments/attempts/${ATTEMPT}/admit-card` });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("ADMIT_CARD_UNAVAILABLE");
    await app.close();
  });

  it("403s a non-HR role", async () => {
    H.ctx.roles = ["employee"];
    const app = await appWith(admitCardRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/assessments/attempts/${ATTEMPT}/admit-card` });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe("GET /v1/hrms/job-openings/:id/applications (DETAIL-08: contact masked before it leaves the service)", () => {
  it("returns masked email/mobile and never the full values", async () => {
    H.listForVacancy.mockResolvedValue([{ ...APPLICATION, qualification: "B.Com", experienceYears: 3, skills: [], source: "public_portal", stage: "applied", appliedAt: new Date("2026-03-01T10:00:00Z"), category: "sc" }]);
    const app = await appWith(recruitmentRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${JOB_ID}/applications` });
    expect(res.statusCode).toBe(200);
    const row = res.json().data[0];
    expect(row).toMatchObject({ email: "a***@e***.com", mobile: "******3210", contactMasked: true, hasResume: false });
    expect(res.body).not.toContain("asha@example.com");
    expect(res.body).not.toContain("9876543210");
    await app.close();
  });
});

describe("GET /v1/hrms/assessments/schedules/:id (attempt projection)", () => {
  it("carries applicationId, frozen and published so a vacancy's results page can filter its own applicants", async () => {
    H.findSchedule.mockResolvedValue({ id: SCHEDULE, title: "Written Test", mode: "online", status: "open", paper: [{ questionId: "q1" }], windowStart: new Date(), windowEnd: new Date() });
    H.listAttemptsBySchedule.mockResolvedValue([{ id: ATTEMPT, candidateId: "55555555-0001-4000-8000-000000000005", applicationId: APP_ID, status: "evaluated", result: "pass", slotLabel: "A", frozen: true, published: false }]);
    const app = await appWith(assessmentAttemptRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/assessments/schedules/${SCHEDULE}` });
    expect(res.statusCode).toBe(200);
    expect(res.json().attempts[0]).toMatchObject({ id: ATTEMPT, applicationId: APP_ID, frozen: true, published: false, result: "pass", slotLabel: "A" });
    expect(res.body).not.toContain("questionId");
    await app.close();
  });
});

describe("GET /v1/hrms/applications/:id (single record, DETAIL-08)", () => {
  it("returns the email masked and flags whether a resume file can be opened; mobile is never returned", async () => {
    H.findApplicationById.mockResolvedValue({ ...APPLICATION, qualification: "B.Com", experienceYears: 3, skills: [], source: "public_portal", stage: "applied", status: "active", appliedAt: new Date("2026-03-01T10:00:00Z"), category: "sc", dateOfBirth: "1995-03-04", resumeRef: null, resumeFileKey: "careers-resumes/t/x.pdf" });
    const app = await appWith(recruitmentRoutes);
    const res = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP_ID}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ email: "a***@e***.com", contactMasked: true, hasResume: true, resumeViewable: true });
    expect(res.body).not.toContain("asha@example.com");
    expect(res.body).not.toContain("9876543210");
    await app.close();
  });
});
