/**
 * Reservation roster + shortlist routes — set/approve (SoD) roster and compute
 * the category-wise shortlist honouring the meritorious-reserved rule.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-aaaa-4000-8000-000000000aaa";
const CREATOR = "aaaaaaaa-1111-4000-8000-000000000aaa";
const APPROVER = "aaaaaaaa-2222-4000-8000-000000000aaa";
const JOB = "cccccccc-aaaa-4000-8000-00000000caaa";
const app1 = (n: number) => `11111111-aaaa-4000-8000-0000000000${String(n).padStart(2, "0")}`;

const H = vi.hoisted(() => ({ findByJob: vi.fn(), insertRoster: vi.fn(), updateRoster: vi.fn() }));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/reservation-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findByJob: (...a: unknown[]) => H.findByJob(...a),
  insertRoster: (...a: unknown[]) => H.insertRoster(...a),
  updateRoster: (...a: unknown[]) => H.updateRoster(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (sub: string, roles: string[]) => `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}`;
const creator = { authorization: tok(CREATOR, ["hr_admin"]) };
const approver = { authorization: tok(APPROVER, ["hr_admin"]) };
const officer = { authorization: tok(APPROVER, ["hr_officer"]) };
const roster = (over = {}) => ({ id: "r", tenantId: TENANT, jobOpeningId: JOB, totalVacancies: 4, categoryVacancies: { UR: 2, SC: 1, OBC: 1 }, locationRosters: {}, status: "draft", createdBy: CREATOR, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.insertRoster.mockResolvedValue(undefined);
  H.updateRoster.mockResolvedValue(undefined);
  H.findByJob.mockResolvedValue(null);
});
afterAll(async () => { await sqlClient.end(); });

describe("reservation roster + shortlist routes", () => {
  it("creates a draft roster when the category vacancies sum to the total (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${JOB}/reservation-roster`, headers: creator, payload: { totalVacancies: 4, categoryVacancies: { UR: 2, SC: 1, OBC: 1 } } });
    expect(r.statusCode).toBe(200);
    expect(H.insertRoster).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a roster whose category vacancies do not sum to the total (422)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${JOB}/reservation-roster`, headers: creator, payload: { totalVacancies: 4, categoryVacancies: { UR: 2, SC: 1 } } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_ROSTER");
    await app.close();
  });

  it("refuses to change an approved roster (409)", async () => {
    H.findByJob.mockResolvedValue(roster({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${JOB}/reservation-roster`, headers: creator, payload: { totalVacancies: 4, categoryVacancies: { UR: 2, SC: 1, OBC: 1 } } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("APPROVED");
    await app.close();
  });

  it("blocks the creator from approving the roster (403 SoD) and is senior-only", async () => {
    H.findByJob.mockResolvedValue(roster());
    const app = await buildApp();
    const self = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/reservation-roster/approve`, headers: creator, payload: {} });
    expect(self.statusCode).toBe(403);
    expect(self.json().code).toBe("SOD_VIOLATION");
    const denied = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/reservation-roster/approve`, headers: officer, payload: {} });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/reservation-roster/approve`, headers: approver, payload: {} });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("refuses to shortlist against an unapproved roster (409)", async () => {
    H.findByJob.mockResolvedValue(roster({ status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/reservation-shortlist`, headers: creator, payload: { candidates: [{ applicationId: app1(1), category: "GEN", score: 90 }] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ROSTER_NOT_APPROVED");
    await app.close();
  });

  it("computes the category-wise shortlist with the meritorious-reserved rule (200)", async () => {
    H.findByJob.mockResolvedValue(roster({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/reservation-shortlist`, headers: creator, payload: {
      candidates: [
        { applicationId: app1(1), category: "OBC", score: 90 }, // top -> UR (meritorious)
        { applicationId: app1(2), category: "GEN", score: 85 },
        { applicationId: app1(3), category: "SC", score: 80 },
        { applicationId: app1(4), category: "OBC", score: 75 },
      ],
    } });
    expect(r.statusCode).toBe(200);
    const byApp = Object.fromEntries(r.json().selected.map((s: { applicationId: string; allocatedAgainst: string }) => [s.applicationId, s.allocatedAgainst]));
    expect(byApp[app1(1)]).toBe("UR");   // OBC top scorer counted against UR
    expect(byApp[app1(4)]).toBe("OBC");  // freed OBC slot filled by next OBC
    expect(r.json().filled).toMatchObject({ UR: 2, SC: 1, OBC: 1 });
    await app.close();
  });

  it("fails closed on an unrecognised candidate category (422), never silently UR", async () => {
    H.findByJob.mockResolvedValue(roster({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/reservation-shortlist`, headers: creator, payload: {
      candidates: [{ applicationId: app1(1), category: "OBC", score: 90 }, { applicationId: app1(2), category: "MYSTERY", score: 95 }],
    } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("UNMAPPED_CATEGORY");
    await app.close();
  });

  it("rejects a location roster that over-allocates beyond the approved category vacancies (422)", async () => {
    H.findByJob.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "PUT", url: `/v1/hrms/job-openings/${JOB}/reservation-roster`, headers: creator, payload: {
      totalVacancies: 4, categoryVacancies: { UR: 2, SC: 1, OBC: 1 },
      locationRosters: { north: { UR: 1, SC: 1, OBC: 1 }, south: { UR: 1, SC: 1 } }, // SC sums to 2 > approved 1
    } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_ROSTER");
    await app.close();
  });

  it("refuses a location shortlist when the roster has no per-location breakdown (409)", async () => {
    H.findByJob.mockResolvedValue(roster({ status: "approved", locationRosters: {} }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${JOB}/reservation-shortlist`, headers: creator, payload: { byLocation: true, candidates: [{ applicationId: app1(1), category: "GEN", score: 90, location: "north" }] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_LOCATION_ROSTERS");
    await app.close();
  });
});
