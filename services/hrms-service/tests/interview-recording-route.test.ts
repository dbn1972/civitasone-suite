/**
 * R-RA-0152 — interview recording/transcript routes (consent + retention + erasure).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0152-4000-8000-000000000152";
const USER = "aaaaaaaa-7777-4000-8000-000000000152";
const IV = "dddddddd-0152-4000-8000-00000000d152";
const APPID = "eeeeeeee-0152-4000-8000-00000000e152";
const REC = "ffffffff-0152-4000-8000-00000000f152";

const H = vi.hoisted(() => ({
  findInterview: vi.fn(), insertRecording: vi.fn(), findRecording: vi.fn(),
  listForInterview: vi.fn(), listExpired: vi.fn(), softDelete: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/modules/recruitment/interview-comms-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findInterview: (...a: unknown[]) => H.findInterview(...a),
}));
vi.mock("../src/modules/recruitment/interview-recording-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertRecording: (...a: unknown[]) => H.insertRecording(...a),
  findRecording: (...a: unknown[]) => H.findRecording(...a),
  listForInterview: (...a: unknown[]) => H.listForInterview(...a),
  listExpired: (...a: unknown[]) => H.listExpired(...a),
  softDelete: (...a: unknown[]) => H.softDelete(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const KEY = `interviews/${IV}/recordings/session.mp4`;

beforeEach(() => {
  vi.clearAllMocks();
  H.findInterview.mockResolvedValue({ id: IV, tenantId: TENANT, applicationId: APPID, status: "scheduled", version: 1 });
  H.insertRecording.mockResolvedValue(undefined);
  H.findRecording.mockResolvedValue({ id: REC, tenantId: TENANT, interviewId: IV, storageKey: KEY, status: "active", version: 1 });
  H.listForInterview.mockResolvedValue([{ id: REC, kind: "recording", status: "active" }]);
  H.listExpired.mockResolvedValue([{ id: REC, retentionUntil: "2020-01-01", status: "active" }]);
  H.softDelete.mockResolvedValue(true);
});
afterAll(async () => { await sqlClient.end(); });

describe("interview recording consent + retention (R-RA-0152)", () => {
  it("registers a consented recording with a retention deadline (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/recordings`, headers: auth(), payload: { kind: "recording", storageKey: KEY, consentGiven: true, consentReference: "econsent-1", retentionDays: 90 } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("active");
    expect(r.json().retentionUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(H.insertRecording).toHaveBeenCalledOnce();
    await app.close();
  });

  it("REJECTS a recording without consent (422)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/recordings`, headers: auth(), payload: { kind: "recording", storageKey: KEY, consentGiven: false } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_RECORDING");
    expect(H.insertRecording).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a storageKey outside the interview namespace (422, IDOR guard)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/recordings`, headers: auth(), payload: { kind: "recording", storageKey: "interviews/other/recordings/x.mp4", consentGiven: true, consentReference: "e-1" } });
    expect(r.statusCode).toBe(422);
    expect(H.insertRecording).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a path-traversal storageKey even under the prefix (422)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/recordings`, headers: auth(), payload: { kind: "recording", storageKey: `interviews/${IV}/recordings/../../other/x.mp4`, consentGiven: true, consentReference: "e-1" } });
    expect(r.statusCode).toBe(422);
    expect(H.insertRecording).not.toHaveBeenCalled();
    await app.close();
  });

  it("404 when registering for a missing interview", async () => {
    H.findInterview.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/recordings`, headers: auth(), payload: { kind: "recording", storageKey: KEY, consentGiven: true } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("lists active recordings (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/recordings`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("erases (soft-deletes) a recording as an admin (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/interview-recordings/${REC}`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("deleted");
    expect(H.softDelete).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids a non-admin from erasing (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/interview-recordings/${REC}`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("404 when erasing a non-active/absent recording", async () => {
    H.findRecording.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "DELETE", url: `/v1/hrms/interview-recordings/${REC}`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("lists retention purge candidates for an admin (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/recordings/expired?asOf=2026-01-01`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().asOf).toBe("2026-01-01");
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/recordings` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
