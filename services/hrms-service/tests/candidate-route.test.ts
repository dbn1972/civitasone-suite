/**
 * Candidate route wiring — register (dup-checked), edit (field-lock), submit
 * (consent), education/employment (draft-only), withdraw, data-request.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000e11";
const USER = "aaaaaaaa-7777-4000-8000-000000000e11";
const CID = "cccccccc-0000-4000-8000-00000000e011";

const H = vi.hoisted(() => ({
  findMock: vi.fn(), dupMock: vi.fn(), insMock: vi.fn(), updMock: vi.fn(),
  insEduMock: vi.fn(), insEmpMock: vi.fn(), cEduMock: vi.fn(), cEmpMock: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/candidate-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findCandidate: (...a: unknown[]) => H.findMock(...a),
  findDuplicates: (...a: unknown[]) => H.dupMock(...a),
  insertCandidate: (...a: unknown[]) => H.insMock(...a),
  updateCandidate: (...a: unknown[]) => H.updMock(...a),
  insertEducation: (...a: unknown[]) => H.insEduMock(...a),
  insertEmployment: (...a: unknown[]) => H.insEmpMock(...a),
  countEducation: (...a: unknown[]) => H.cEduMock(...a),
  countEmployment: (...a: unknown[]) => H.cEmpMock(...a),
  listEducation: async () => [], listEmployment: async () => [],
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const auth = { authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const cand = (over = {}) => ({ id: CID, tenantId: TENANT, email: "a@x.in", status: "draft", version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.dupMock.mockResolvedValue([]); H.insMock.mockResolvedValue(undefined); H.updMock.mockResolvedValue(undefined);
  H.insEduMock.mockResolvedValue(undefined); H.insEmpMock.mockResolvedValue(undefined);
  H.cEduMock.mockResolvedValue(1); H.cEmpMock.mockResolvedValue(1);
});
afterAll(async () => { await sqlClient.end(); });

describe("candidate routes", () => {
  it("registers a candidate (201) and blocks a duplicate (409)", async () => {
    const app = await buildApp();
    const ok = await app.inject({ method: "POST", url: "/v1/hrms/candidates", headers: auth, payload: { email: "New@X.in", mobile: "+91 98765 43210", fullName: "N" } });
    expect(ok.statusCode).toBe(201);
    expect(H.insMock).toHaveBeenCalledOnce();
    H.dupMock.mockResolvedValue([{ id: "existing", matchedOn: "email" }]);
    const dup = await app.inject({ method: "POST", url: "/v1/hrms/candidates", headers: auth, payload: { email: "new@x.in" } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("DUPLICATE_CANDIDATE");
    await app.close();
  });

  it("does not use a garbage mobile as a dedup key (no false duplicate collision)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/candidates", headers: auth, payload: { email: "g@x.in", mobile: "N/A" } });
    expect(r.statusCode).toBe(201);
    // findDuplicates was called WITHOUT a normalizedMobile key
    expect(H.dupMock.mock.calls[0][1]).not.toHaveProperty("normalizedMobile");
    // and the row stored a null normalized_mobile (raw mobile kept, no dedup key)
    expect(H.insMock.mock.calls[0][1].normalizedMobile).toBeNull();
    await app.close();
  });

  it("duplicate-check reports matches without writing", async () => {
    H.dupMock.mockResolvedValue([{ id: "x", matchedOn: "mobile" }]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/candidates/duplicate-check", headers: auth, payload: { mobile: "9876543210" } });
    expect(r.json()).toMatchObject({ duplicate: true });
    expect(H.insMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects editing a locked field after submission but allows contact edits", async () => {
    H.findMock.mockResolvedValue(cand({ status: "submitted" }));
    const app = await buildApp();
    const locked = await app.inject({ method: "PATCH", url: `/v1/hrms/candidates/${CID}`, headers: auth, payload: { dateOfBirth: "2000-01-01" } });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().code).toBe("FIELDS_LOCKED");
    const ok = await app.inject({ method: "PATCH", url: `/v1/hrms/candidates/${CID}`, headers: auth, payload: { correspondenceAddress: "New addr" } });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("requires versioned consent to submit", async () => {
    H.findMock.mockResolvedValue(cand({ status: "draft" }));
    const app = await buildApp();
    const noConsent = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/submit`, headers: auth, payload: {} });
    expect(noConsent.statusCode).toBe(400);
    expect(noConsent.json().code).toBe("CONSENT_REQUIRED");
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/submit`, headers: auth, payload: { consentAccepted: true, consentVersion: "v2.0" } });
    expect(ok.json()).toMatchObject({ status: "submitted", consentVersion: "v2.0" });
    await app.close();
  });

  it("adds history only while draft", async () => {
    H.findMock.mockResolvedValue(cand({ status: "draft" }));
    const app = await buildApp();
    const ok = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/education`, headers: auth, payload: { qualification: "B.Tech", yearOfPassing: 2020, marksPercent: 78.5 } });
    expect(ok.statusCode).toBe(201);
    H.findMock.mockResolvedValue(cand({ status: "submitted" }));
    const locked = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/employment`, headers: auth, payload: { employer: "X" } });
    expect(locked.statusCode).toBe(409);
    await app.close();
  });

  it("withdraws and records a data request", async () => {
    H.findMock.mockResolvedValue(cand({ status: "submitted" }));
    const app = await buildApp();
    const w = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/withdraw`, headers: auth });
    expect(w.json().status).toBe("withdrawn");
    const d = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/data-request`, headers: auth });
    expect(d.json().dataRequestRecorded).toBe(true);
    await app.close();
  });
});
