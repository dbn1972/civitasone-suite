/**
 * Additional route-level tests for the recruitment module — publication routes
 * (advertisement, corrigendum, extend, cancel, career search), selection list
 * (expire, get-by-id, get-by-job), and panel (get panel, duplicate panelists,
 * waitlist outcome). Targets under-tested endpoints to push coverage above 80%.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0001-4000-8000-000000000001";
const USER = "aaaaaaaa-1111-4000-8000-000000000001";
const USER2 = "aaaaaaaa-2222-4000-8000-000000000001";
const JOB = "cccccccc-0001-4000-8000-00000000c001";
const LIST_ID = "dddddddd-0001-4000-8000-00000000d001";
const IV = "eeeeeeee-0001-4000-8000-00000000e001";
const OFF = "ffffffff-0001-4000-8000-00000000f001";
const M1 = "11111111-0001-4000-8000-000000000001";
const M2 = "11111111-0001-4000-8000-000000000002";

const H = vi.hoisted(() => ({
  // publication-repo
  findVacancy: vi.fn(),
  updateVacancy: vi.fn(),
  nextCorrigendumSeq: vi.fn(),
  insertCorrigendum: vi.fn(),
  listCorrigenda: vi.fn(),
  searchVacancies: vi.fn(),
  // selection-repo
  findList: vi.fn(),
  updateList: vi.fn(),
  listEntries: vi.fn(),
  listByJob: vi.fn(),
  insertList: vi.fn(),
  setEntries: vi.fn(),
  // panel-repo
  findInterview: vi.fn(),
  updateInterview: vi.fn(),
  setPanelists: vi.fn(),
  listPanelists: vi.fn(),
  recusePanelist: vi.fn(),
  // offer-repo
  findOffer: vi.fn(),
  updateOffer: vi.fn(),
  // offer-analytics-repo
  listOffersForAnalytics: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => {} },
}));
vi.mock("../src/modules/recruitment/publication-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findVacancy: (...a: unknown[]) => H.findVacancy(...a),
  updateVacancy: (...a: unknown[]) => H.updateVacancy(...a),
  nextCorrigendumSeq: (...a: unknown[]) => H.nextCorrigendumSeq(...a),
  insertCorrigendum: (...a: unknown[]) => H.insertCorrigendum(...a),
  listCorrigenda: (...a: unknown[]) => H.listCorrigenda(...a),
  searchVacancies: (...a: unknown[]) => H.searchVacancies(...a),
}));
vi.mock("../src/modules/recruitment/selection-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findList: (...a: unknown[]) => H.findList(...a),
  updateList: (...a: unknown[]) => H.updateList(...a),
  listEntries: (...a: unknown[]) => H.listEntries(...a),
  listByJob: (...a: unknown[]) => H.listByJob(...a),
  insertList: (...a: unknown[]) => H.insertList(...a),
  setEntries: (...a: unknown[]) => H.setEntries(...a),
}));
vi.mock("../src/modules/recruitment/panel-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findInterview: (...a: unknown[]) => H.findInterview(...a),
  updateInterview: (...a: unknown[]) => H.updateInterview(...a),
  setPanelists: (...a: unknown[]) => H.setPanelists(...a),
  listPanelists: (...a: unknown[]) => H.listPanelists(...a),
  recusePanelist: (...a: unknown[]) => H.recusePanelist(...a),
}));
vi.mock("../src/modules/recruitment/offer-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findOffer: (...a: unknown[]) => H.findOffer(...a),
  updateOffer: (...a: unknown[]) => H.updateOffer(...a),
}));
vi.mock("../src/modules/recruitment/offer-analytics-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listOffersForAnalytics: (...a: unknown[]) => H.listOffersForAnalytics(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (sub = USER, roles = ["hr_admin"]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (sub = USER, roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(sub, roles)}` });
const futureIso = new Date(Date.now() + 90 * 86400_000).toISOString();

// --- factories ---
const vacancy = (over = {}) => ({
  id: JOB, tenantId: TENANT, status: "open", applicationDeadline: new Date("2026-12-31"),
  corrigendumCount: 0, version: 1, isPublished: "true", portalScope: "public", ...over,
});
const selList = (over = {}) => ({
  id: LIST_ID, tenantId: TENANT, jobOpeningId: JOB, title: "Merit", vacancies: 2,
  status: "draft", createdBy: USER2, entriesSetBy: null, validityUntil: null, version: 1, ...over,
});
const interview = (over = {}) => ({ id: IV, tenantId: TENANT, outcomeStatus: "pending", version: 1, ...over });
const panelist = (over = {}) => ({ memberId: M1, memberName: "M", panelRole: "member", coiDeclared: false, coiType: "none", recused: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findVacancy.mockResolvedValue(vacancy());
  H.updateVacancy.mockResolvedValue(undefined);
  H.nextCorrigendumSeq.mockResolvedValue(1);
  H.insertCorrigendum.mockResolvedValue(undefined);
  H.listCorrigenda.mockResolvedValue([]);
  H.searchVacancies.mockResolvedValue([]);
  H.findList.mockResolvedValue(selList());
  H.updateList.mockResolvedValue(undefined);
  H.listEntries.mockResolvedValue([]);
  H.listByJob.mockResolvedValue([]);
  H.insertList.mockResolvedValue(undefined);
  H.setEntries.mockResolvedValue(undefined);
  H.findInterview.mockResolvedValue(interview());
  H.updateInterview.mockResolvedValue(undefined);
  H.setPanelists.mockResolvedValue(undefined);
  H.listPanelists.mockResolvedValue([]);
  H.recusePanelist.mockResolvedValue(1);
  H.findOffer.mockResolvedValue(null);
  H.updateOffer.mockResolvedValue(undefined);
  H.listOffersForAnalytics.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

// ===========================================================================
// PUBLICATION ROUTES
// ===========================================================================
describe("publication routes — advertisement", () => {
  it("updates advertisement details (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({
      method: "PATCH", url: `/v1/hrms/job-openings/${JOB}/advertisement`,
      headers: auth(), payload: { feesMinor: 500, portalScope: "both", selectionProcess: "Written exam + interview" },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().updated).toBe(true);
    expect(H.updateVacancy).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 400 for invalid UUID param", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/not-a-uuid/advertisement`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${JOB}/advertisement`, payload: {} });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorised role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${JOB}/advertisement`, headers: auth(USER, ["employee"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when vacancy not found", async () => {
    H.findVacancy.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${JOB}/advertisement`, headers: auth(), payload: { portalScope: "internal" } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("publication routes — corrigendum", () => {
  it("records a corrigendum (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/corrigendum`, headers: auth(), payload: { changes: "Updated eligibility criteria for age relaxation" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().corrigendumSeq).toBe(1);
    expect(H.insertCorrigendum).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 400 when changes field is missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/corrigendum`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 409 for a cancelled vacancy", async () => {
    H.findVacancy.mockResolvedValue(vacancy({ status: "cancelled" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/corrigendum`, headers: auth(), payload: { changes: "some fix" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CANCELLED");
    await app.close();
  });

  it("returns 404 when vacancy not found", async () => {
    H.findVacancy.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/corrigendum`, headers: auth(), payload: { changes: "fix" } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("publication routes — extend deadline", () => {
  it("extends the deadline and reopens the vacancy (200)", async () => {
    // Set existing deadline to a past/near date so the extension is "later"
    H.findVacancy.mockResolvedValue(vacancy({ applicationDeadline: new Date("2025-01-15") }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/extend`, headers: auth(), payload: { newDeadline: futureIso, reason: "more applicants needed" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("open");
    expect(H.insertCorrigendum).toHaveBeenCalledOnce();
    await app.close();
  });

  it("returns 400 when the new deadline is not later than the current one", async () => {
    H.findVacancy.mockResolvedValue(vacancy({ applicationDeadline: new Date("2027-12-31") }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/extend`, headers: auth(), payload: { newDeadline: "2026-06-01T00:00:00.000Z" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("NOT_AN_EXTENSION");
    await app.close();
  });

  it("returns 409 for a cancelled vacancy", async () => {
    H.findVacancy.mockResolvedValue(vacancy({ status: "cancelled" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/extend`, headers: auth(), payload: { newDeadline: futureIso } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("CANCELLED");
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/extend`, payload: { newDeadline: futureIso } });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorised role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/extend`, headers: auth(USER, ["employee"]), payload: { newDeadline: futureIso } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("publication routes — cancel vacancy", () => {
  it("cancels an open vacancy (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/cancel`, headers: auth(), payload: { reason: "position no longer required" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("cancelled");
    await app.close();
  });

  it("returns 409 when already cancelled", async () => {
    H.findVacancy.mockResolvedValue(vacancy({ status: "cancelled" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/cancel`, headers: auth(), payload: { reason: "duplicate" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ALREADY_CANCELLED");
    await app.close();
  });

  it("returns 400 when reason is missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/cancel`, headers: auth(), payload: {} });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 404 when vacancy not found", async () => {
    H.findVacancy.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/cancel`, headers: auth(), payload: { reason: "gone" } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("publication routes — corrigenda history", () => {
  it("returns corrigendum history (200)", async () => {
    H.listCorrigenda.mockResolvedValue([{ seq: 1, action: "corrigendum", changes: "age updated" }]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${JOB}/corrigenda`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("returns 404 when vacancy not found", async () => {
    H.findVacancy.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${JOB}/corrigenda`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("allows manager role to view corrigenda (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${JOB}/corrigenda`, headers: auth(USER, ["manager"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("returns 403 for unauthorised role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${JOB}/corrigenda`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("publication routes — career search (public)", () => {
  it("searches public vacancies without auth (200)", async () => {
    H.searchVacancies.mockResolvedValue([{ id: JOB, refNo: "REF-1", title: "Engineer", titleAlt: null, location: "Delhi", vacancyType: "regular", vacancies: 5, qualification: "BE", minExperienceYears: 2, feesMinor: 500, selectionProcess: "test", importantDates: {}, eligibility: "grad", postedAt: new Date(), applicationDeadline: new Date() }]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/careers/search?tenantId=${TENANT}&keyword=Engineer` });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    expect(r.json().data[0].title).toBe("Engineer");
    await app.close();
  });

  it("returns 400 when tenantId is missing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/careers/search` });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid tenantId format", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/careers/search?tenantId=not-a-uuid` });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns empty data when no vacancies match (200)", async () => {
    H.searchVacancies.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/careers/search?tenantId=${TENANT}&keyword=nonexistent` });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(0);
    await app.close();
  });
});

// ===========================================================================
// SELECTION LIST ROUTES — additional coverage
// ===========================================================================
describe("selection list routes — expire", () => {
  it("expires a published list (200)", async () => {
    H.findList.mockResolvedValue(selList({ status: "published" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/selection-lists/${LIST_ID}/expire`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("expired");
    await app.close();
  });

  it("expires an approved list (200)", async () => {
    H.findList.mockResolvedValue(selList({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/selection-lists/${LIST_ID}/expire`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("expired");
    await app.close();
  });

  it("returns 409 when already expired", async () => {
    H.findList.mockResolvedValue(selList({ status: "expired" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/selection-lists/${LIST_ID}/expire`, headers: auth() });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVALID_STATE");
    await app.close();
  });

  it("returns 409 for a draft list", async () => {
    H.findList.mockResolvedValue(selList({ status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/selection-lists/${LIST_ID}/expire`, headers: auth() });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INVALID_STATE");
    await app.close();
  });

  it("returns 403 for hr_officer (senior-only)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/selection-lists/${LIST_ID}/expire`, headers: auth(USER, ["hr_officer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when list not found", async () => {
    H.findList.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/selection-lists/${LIST_ID}/expire`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });
});

describe("selection list routes — get by ID", () => {
  it("returns a list with entries and withinValidity flag (200)", async () => {
    const futureDate = new Date(Date.now() + 90 * 86400_000).toISOString().slice(0, 10);
    H.findList.mockResolvedValue(selList({ status: "published", validityUntil: futureDate }));
    H.listEntries.mockResolvedValue([
      { applicationId: M1, candidateName: "A", category: "selected", rank: 1, score: "85", remarks: null },
      { applicationId: M2, candidateName: "B", category: "waitlist", rank: 1, score: "72", remarks: null },
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/selection-lists/${LIST_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.withinValidity).toBe(true);
    expect(body.entries).toHaveLength(2);
    await app.close();
  });

  it("returns withinValidity false for an expired validity", async () => {
    const pastDate = "2020-01-01";
    H.findList.mockResolvedValue(selList({ status: "published", validityUntil: pastDate }));
    H.listEntries.mockResolvedValue([]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/selection-lists/${LIST_ID}`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().withinValidity).toBe(false);
    await app.close();
  });

  it("returns 404 when list not found", async () => {
    H.findList.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/selection-lists/${LIST_ID}`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/selection-lists/${LIST_ID}` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("selection list routes — get by job opening", () => {
  it("returns lists for a job opening (200)", async () => {
    H.listByJob.mockResolvedValue([selList(), selList({ id: "dddddddd-0001-4000-8000-00000000d002", status: "published" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${JOB}/selection-lists`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(2);
    await app.close();
  });

  it("returns 400 for invalid job opening ID", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/bad-id/selection-lists`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 403 for unauthorised role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/job-openings/${JOB}/selection-lists`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

// ===========================================================================
// PANEL ROUTES — additional coverage
// ===========================================================================
describe("panel routes — get panel", () => {
  it("returns panel members with readiness (200)", async () => {
    H.listPanelists.mockResolvedValue([
      panelist({ memberId: M1, panelRole: "chair", memberName: "Chair" }),
      panelist({ memberId: M2, panelRole: "member", memberName: "Member" }),
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.panelists).toHaveLength(2);
    expect(body.readiness.ready).toBe(true);
    expect(body.readiness.hasChair).toBe(true);
    await app.close();
  });

  it("returns 404 when interview not found", async () => {
    H.findInterview.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/panel` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("returns 403 for unauthorised role", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth(USER, ["employee"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});

describe("panel routes — duplicate panelists validation", () => {
  it("returns 422 for duplicate panelist IDs", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth(), payload: {
      members: [
        { memberId: M1, memberName: "A", panelRole: "chair" },
        { memberId: M1, memberName: "A again", panelRole: "member" },
      ],
    } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("DUPLICATE_PANELIST");
    await app.close();
  });

  it("returns 422 when coiType is set without coiDeclared flag", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth(), payload: {
      members: [{ memberId: M1, memberName: "A", panelRole: "chair", coiDeclared: false, coiType: "relative" }],
    } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("COI_FLAG_REQUIRED");
    await app.close();
  });
});

describe("panel routes — waitlist outcome", () => {
  it("records a waitlist outcome with rank and validity (200)", async () => {
    H.listPanelists.mockResolvedValue([panelist({ memberId: M1, panelRole: "chair" }), panelist({ memberId: M2 })]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth(), payload: { status: "waitlisted", waitlistRank: 3, validUntil: futureIso } });
    expect(r.statusCode).toBe(200);
    expect(r.json().outcomeStatus).toBe("waitlisted");
    await app.close();
  });

  it("returns 422 when waitlistRank is missing for waitlisted status", async () => {
    H.listPanelists.mockResolvedValue([panelist({ memberId: M1, panelRole: "chair" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth(), payload: { status: "waitlisted", validUntil: futureIso } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_OUTCOME");
    await app.close();
  });

  it("returns 422 when validUntil is missing for recommended status", async () => {
    H.listPanelists.mockResolvedValue([panelist({ memberId: M1, panelRole: "chair" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth(), payload: { status: "recommended" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_OUTCOME");
    await app.close();
  });

  it("returns 404 when interview not found", async () => {
    H.findInterview.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth(), payload: { status: "recommended", validUntil: futureIso } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("records a rejected outcome with reason (200)", async () => {
    H.listPanelists.mockResolvedValue([panelist({ memberId: M1, panelRole: "chair" }), panelist({ memberId: M2 })]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth(), payload: { status: "rejected", rejectionReason: "low_score", rejectionNote: "Below threshold" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().outcomeStatus).toBe("rejected");
    await app.close();
  });

  it("returns 409 when panel has no active voting members (PANEL_NOT_READY)", async () => {
    // All members recused — panel not ready
    H.listPanelists.mockResolvedValue([panelist({ memberId: M1, panelRole: "observer" })]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth(), payload: { status: "recommended", validUntil: futureIso } });
    expect(r.statusCode).toBe(409);
    await app.close();
  });
});

describe("panel routes — recuse panelist", () => {
  it("returns 404 when panelist not found on interview", async () => {
    H.recusePanelist.mockResolvedValue(0);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/panelists/${M1}/recuse`, headers: auth() });
    expect(r.statusCode).toBe(404);
    expect(r.json().code).toBe("NOT_FOUND");
    await app.close();
  });

  it("returns 400 for invalid memberId param", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/panelists/not-a-uuid/recuse`, headers: auth() });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});

// ===========================================================================
// OFFER EXTRA ROUTES — additional edge cases
// ===========================================================================
describe("offer-extra routes — extension rejection", () => {
  it("rejects a pending extension (200)", async () => {
    H.findOffer.mockResolvedValue({ id: OFF, tenantId: TENANT, status: "accepted", joiningExtensionStatus: "requested", requestedJoiningDate: "2026-10-15", requestedBy: USER2, version: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/reject`, headers: auth() });
    expect(r.statusCode).toBe(200);
    expect(r.json().joiningExtensionStatus).toBe("rejected");
    await app.close();
  });

  it("returns 409 when no pending extension to reject", async () => {
    H.findOffer.mockResolvedValue({ id: OFF, tenantId: TENANT, status: "accepted", joiningExtensionStatus: "none", version: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/reject`, headers: auth() });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_REQUEST");
    await app.close();
  });

  it("returns 403 for hr_officer (senior-only)", async () => {
    H.findOffer.mockResolvedValue({ id: OFF, tenantId: TENANT, status: "accepted", joiningExtensionStatus: "requested", requestedBy: USER2, version: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/reject`, headers: auth(USER, ["hr_officer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("returns 404 when offer not found", async () => {
    H.findOffer.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/reject`, headers: auth() });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("returns 401 without auth", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension/reject` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});

describe("offer-extra routes — extension request edge cases", () => {
  it("returns 409 when an extension is already pending", async () => {
    H.findOffer.mockResolvedValue({ id: OFF, tenantId: TENANT, status: "accepted", joiningDate: "2026-09-01", joiningExtensionStatus: "requested", originalJoiningDate: "2026-09-01", version: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth(), payload: { requestedJoiningDate: "2026-11-01", reason: "need more time" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("EXTENSION_PENDING");
    await app.close();
  });

  it("returns 400 for invalid body (reason too short)", async () => {
    H.findOffer.mockResolvedValue({ id: OFF, tenantId: TENANT, status: "accepted", joiningDate: "2026-09-01", joiningExtensionStatus: "none", version: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth(), payload: { requestedJoiningDate: "2026-10-15", reason: "ab" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("returns 400 for invalid date format", async () => {
    H.findOffer.mockResolvedValue({ id: OFF, tenantId: TENANT, status: "accepted", joiningDate: "2026-09-01", joiningExtensionStatus: "none", version: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/offers/${OFF}/joining-extension`, headers: auth(), payload: { requestedJoiningDate: "not-a-date", reason: "relocation" } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });
});
