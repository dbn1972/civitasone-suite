/**
 * Application & eligibility route wiring — configure criteria, dry-run check,
 * eligibility-enforced apply (blocks ineligible + duplicates, issues an
 * application number), and withdraw.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000a11";
const USER = "aaaaaaaa-7777-4000-8000-000000000a11";
const VAC = "bbbbbbbb-0000-4000-8000-00000000b011";
const APP = "cccccccc-0000-4000-8000-00000000c011";

const H = vi.hoisted(() => ({
  findVacancyMock: vi.fn(),
  setEligMock: vi.fn(),
  countMock: vi.fn(),
  insertAppMock: vi.fn(),
  findAppMock: vi.fn(),
  withdrawMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/eligibility-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findVacancy: (...a: unknown[]) => H.findVacancyMock(...a),
  setVacancyEligibility: (...a: unknown[]) => H.setEligMock(...a),
  countApplicationsForEmail: (...a: unknown[]) => H.countMock(...a),
  insertApplication: (...a: unknown[]) => H.insertAppMock(...a),
  findApplication: (...a: unknown[]) => H.findAppMock(...a),
  withdrawApplication: (...a: unknown[]) => H.withdrawMock(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const auth = { authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const CRITERIA = { ageMin: 21, ageMax: 35, cutoffDate: "2026-01-01", experienceMinYears: 2, categoryAgeRelaxation: { OBC: 3 }, allowMultiple: false };
const vacancy = (over = {}) => ({ id: VAC, tenantId: TENANT, status: "open", eligibility: CRITERIA, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findVacancyMock.mockResolvedValue(vacancy());
  H.setEligMock.mockResolvedValue(undefined);
  H.countMock.mockResolvedValue(0);
  H.insertAppMock.mockResolvedValue(undefined);
  H.withdrawMock.mockResolvedValue(undefined);
});
afterAll(async () => { await sqlClient.end(); });

describe("application eligibility routes", () => {
  it("requires a cut-off date when an age limit is configured (400)", async () => {
    const app = await buildApp();
    const bad = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${VAC}/eligibility`, headers: auth, payload: { ageMax: 35 } });
    expect(bad.statusCode).toBe(400);
    const ok = await app.inject({ method: "PATCH", url: `/v1/hrms/job-openings/${VAC}/eligibility`, headers: auth, payload: { ageMax: 35, cutoffDate: "2026-01-01" } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("dry-runs an eligibility check without writing", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/eligibility-check`, headers: auth,
      payload: { dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 4 } });
    expect(r.statusCode).toBe(200);
    expect(r.json().eligible).toBe(true);
    expect(H.insertAppMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts an eligible applicant and issues an application number", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/applications`, headers: auth,
      payload: { applicantName: "A", email: "a@x.in", dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 4 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().applicationNo).toMatch(/^APP-/);
    expect(r.json().eligibility.eligible).toBe(true);
    expect(H.insertAppMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks an over-age applicant with a structured 422", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/applications`, headers: auth,
      payload: { applicantName: "B", email: "b@x.in", dateOfBirth: "1985-01-01", category: "GEN", experienceYears: 10 } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("NOT_ELIGIBLE");
    expect(r.json().eligibility.checks.some((k: { rule: string; ok: boolean }) => k.rule === "age_max" && !k.ok)).toBe(true);
    expect(H.insertAppMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("admits the same over-age applicant under OBC relaxation", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/applications`, headers: auth,
      payload: { applicantName: "B", email: "b2@x.in", dateOfBirth: "1989-01-01", category: "OBC", experienceYears: 10 } });
    expect(r.statusCode).toBe(201); // age 37, max 35 + 3 = 38 -> eligible
    await app.close();
  });

  it("prevents a duplicate application (409)", async () => {
    H.countMock.mockResolvedValue(1);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/applications`, headers: auth,
      payload: { applicantName: "A", email: "a@x.in", dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 4 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("DUPLICATE_APPLICATION");
    expect(H.insertAppMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a calendar-invalid date of birth (400)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/applications`, headers: auth,
      payload: { applicantName: "A", email: "a@x.in", dateOfBirth: "2026-02-30", category: "GEN", experienceYears: 4 } });
    expect(r.statusCode).toBe(400);
    expect(H.insertAppMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("sets a null dedup_key when the vacancy allows multiple applications", async () => {
    H.findVacancyMock.mockResolvedValue(vacancy({ eligibility: { ...CRITERIA, allowMultiple: true } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/applications`, headers: auth,
      payload: { applicantName: "A", email: "a@x.in", dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 4 } });
    expect(r.statusCode).toBe(201);
    expect(H.insertAppMock.mock.calls[0][1].dedupKey).toBeNull();
    await app.close();
  });

  it("sets dedup_key to lower(email) when multiples are not allowed", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/job-openings/${VAC}/applications`, headers: auth,
      payload: { applicantName: "A", email: "MixedCase@X.in", dateOfBirth: "1998-01-01", category: "GEN", experienceYears: 4 } });
    expect(r.statusCode).toBe(201);
    expect(H.insertAppMock.mock.calls[0][1].dedupKey).toBe("mixedcase@x.in");
    await app.close();
  });

  it("withdraws an application with a reason", async () => {
    H.findAppMock.mockResolvedValue({ id: APP, tenantId: TENANT, status: "active", stage: "applied", version: 1 });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/withdraw`, headers: auth, payload: { reason: "accepted elsewhere" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("withdrawn");
    expect(H.withdrawMock).toHaveBeenCalledOnce();
    await app.close();
  });
});
