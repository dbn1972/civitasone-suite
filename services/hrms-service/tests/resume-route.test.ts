/**
 * R-RA-0087 — candidate resume-version routes (upload / list / activate).
 * repo + shared/db mocked; real route wiring + RBAC + validation run.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-eeee-4000-8000-00000000eeaa";
const USER = "aaaaaaaa-7777-4000-8000-00000000eeaa";
const CID = "dddddddd-eeee-4000-8000-0000000deeaa";
const RID = "ffffffff-eeee-4000-8000-0000000feeaa";

const H = vi.hoisted(() => ({
  findCandidate: vi.fn(),
  createResumeVersion: vi.fn(),
  listResumes: vi.fn(),
  findResume: vi.fn(),
  activateResume: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/modules/recruitment/candidate-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findCandidate: (...a: unknown[]) => H.findCandidate(...a),
}));
vi.mock("../src/modules/recruitment/resume-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  createResumeVersion: (...a: unknown[]) => H.createResumeVersion(...a),
  listResumes: (...a: unknown[]) => H.listResumes(...a),
  findResume: (...a: unknown[]) => H.findResume(...a),
  activateResume: (...a: unknown[]) => H.activateResume(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const token = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = { authorization: `Bearer ${token(["hr_admin"])}` };
const upload = { fileKey: `candidates/${CID}/resumes/cv.pdf`, fileName: "cv.pdf", mimeType: "application/pdf", fileSizeBytes: 2048 };

beforeEach(() => {
  vi.clearAllMocks();
  H.findCandidate.mockResolvedValue({ id: CID, tenantId: TENANT, email: "c@x.in", status: "draft" });
  H.createResumeVersion.mockResolvedValue({ versionNo: 1, isActive: true });
  H.listResumes.mockResolvedValue([
    { id: RID, versionNo: 2, fileKey: "s3://cv-2", fileName: "cv2.pdf", mimeType: "application/pdf", fileSizeBytes: 2048n, fingerprint: null, label: null, isActive: true, createdAt: new Date("2026-07-01T00:00:00Z") },
    { id: "r1", versionNo: 1, fileKey: "s3://cv-1", fileName: "cv1.pdf", mimeType: "application/pdf", fileSizeBytes: 1024n, fingerprint: null, label: null, isActive: false, createdAt: new Date("2026-06-01T00:00:00Z") },
  ]);
  H.findResume.mockResolvedValue({ id: RID, versionNo: 2, fileKey: "s3://cv-2" });
  H.activateResume.mockResolvedValue(1);
});
afterAll(async () => { await sqlClient.end(); });

describe("candidate resume-version routes (R-RA-0087)", () => {
  it("uploads a new resume version (201) and reports the version + active flag", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes`, headers: auth, payload: upload });
    expect(r.statusCode).toBe(201);
    expect(r.json().versionNo).toBe(1);
    expect(r.json().isActive).toBe(true);
    expect(H.createResumeVersion).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects an unsupported file type (422 INVALID_RESUME)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes`, headers: auth, payload: { ...upload, mimeType: "image/png" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_RESUME");
    expect(H.createResumeVersion).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a fileKey outside the candidate namespace (422 INVALID_RESUME, IDOR guard)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes`, headers: auth, payload: { ...upload, fileKey: "candidates/someone-else/resumes/cv.pdf" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_RESUME");
    expect(H.createResumeVersion).not.toHaveBeenCalled();
    await app.close();
  });

  it("returns 400 on a malformed body (missing fileKey)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes`, headers: auth, payload: { fileName: "cv.pdf", mimeType: "application/pdf", fileSizeBytes: 10 } });
    expect(r.statusCode).toBe(400);
    await app.close();
  });

  it("404 when uploading for a missing candidate", async () => {
    H.findCandidate.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes`, headers: auth, payload: upload });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("lists versions newest-first with a stringified size (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/candidates/${CID}/resumes`, headers: auth });
    expect(r.statusCode).toBe(200);
    const data = r.json().data;
    expect(data[0].versionNo).toBe(2);
    expect(data[0].isActive).toBe(true);
    expect(data[0].fileSizeBytes).toBe("2048"); // bigint serialised as string
    await app.close();
  });

  it("activates a resume version (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes/${RID}/activate`, headers: auth });
    expect(r.statusCode).toBe(200);
    expect(r.json().isActive).toBe(true);
    expect(H.activateResume).toHaveBeenCalledOnce();
    await app.close();
  });

  it("404 when activating a resume version that does not exist", async () => {
    H.findResume.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes/${RID}/activate`, headers: auth });
    expect(r.statusCode).toBe(404);
    expect(H.activateResume).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/candidates/${CID}/resumes` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });

  it("forbids a non-HR role (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/candidates/${CID}/resumes`, headers: { authorization: `Bearer ${token(["employee"])}` }, payload: upload });
    expect(r.statusCode).toBe(403);
    await app.close();
  });
});
