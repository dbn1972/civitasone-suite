/**
 * R-RA-0142 — interview comms lifecycle routes (invite/reminder/reschedule/cancel).
 * repo + shared/db + outbox mocked; real route wiring + RBAC + flag behavior run.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1142-4000-8000-000000001142";
const USER = "aaaaaaaa-7777-4000-8000-000000001142";
const IV = "dddddddd-1142-4000-8000-00000000d142";
const APPID = "eeeeeeee-1142-4000-8000-00000000e142";

const H = vi.hoisted(() => ({
  findInterview: vi.fn(), insertComm: vi.fn(), listComms: vi.fn(),
  reschedule: vi.fn(), cancel: vi.fn(), enqueue: vi.fn(), findByIdempotencyKey: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/shared/outbox.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  enqueue: (...a: unknown[]) => H.enqueue(...a),
}));
vi.mock("../src/modules/recruitment/interview-comms-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findInterview: (...a: unknown[]) => H.findInterview(...a),
  insertComm: (...a: unknown[]) => H.insertComm(...a),
  listComms: (...a: unknown[]) => H.listComms(...a),
  rescheduleInterview: (...a: unknown[]) => H.reschedule(...a),
  cancelInterview: (...a: unknown[]) => H.cancel(...a),
  findByIdempotencyKey: (...a: unknown[]) => H.findByIdempotencyKey(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const ivRow = (over = {}) => ({ id: IV, tenantId: TENANT, applicationId: APPID, jobOpeningId: "job", roundType: "technical", scheduledDate: "2026-08-01", scheduledTime: "10:00", status: "scheduled", version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.FEATURE_INTERVIEW_COMMS_ENABLED;
  H.findInterview.mockResolvedValue(ivRow());
  H.insertComm.mockResolvedValue(undefined);
  H.listComms.mockResolvedValue([{ id: "c1", commType: "invite", channel: "stub", status: "stubbed" }]);
  H.reschedule.mockResolvedValue(true);
  H.cancel.mockResolvedValue(true);
  H.enqueue.mockResolvedValue(undefined);
  H.findByIdempotencyKey.mockResolvedValue(null);
});
afterAll(async () => { await sqlClient.end(); });

describe("interview comms lifecycle (R-RA-0142)", () => {
  it("records an invite as a STUB when the flag is off, without enqueueing (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "invite" } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "stubbed", channel: "stub" });
    expect(H.insertComm).toHaveBeenCalledOnce();
    expect(H.enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it("queues to the outbox when the flag is on, with an idempotency key (201, enqueued)", async () => {
    process.env.FEATURE_INTERVIEW_COMMS_ENABLED = "true";
    H.findByIdempotencyKey.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: { ...auth(), "x-idempotency-key": "k-1" }, payload: { type: "invite", channel: "email" } });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: "queued", channel: "email" });
    expect(H.enqueue).toHaveBeenCalledOnce();
    await app.close();
  });

  it("requires an idempotency key when the flag is on (400)", async () => {
    process.env.FEATURE_INTERVIEW_COMMS_ENABLED = "true";
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "invite" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("IDEMPOTENCY_KEY_REQUIRED");
    expect(H.enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it("replays a prior comm for the same idempotency key without re-dispatching (200)", async () => {
    process.env.FEATURE_INTERVIEW_COMMS_ENABLED = "true";
    H.findByIdempotencyKey.mockResolvedValue({ id: "prev", interviewId: IV, commType: "invite", channel: "email", status: "queued" });
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: { ...auth(), "x-idempotency-key": "k-1" }, payload: { type: "invite", channel: "email" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().replay).toBe(true);
    expect(H.insertComm).not.toHaveBeenCalled();
    expect(H.enqueue).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects an invalid calendar date on reschedule (400)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "reschedule", newDate: "2026-13-45", newTime: "10:00" } });
    expect(r.statusCode).toBe(400);
    expect(H.reschedule).not.toHaveBeenCalled();
    await app.close();
  });

  it("requires newDate/newTime for a reschedule (422)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "reschedule" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("SCHEDULE_REQUIRED");
    expect(H.reschedule).not.toHaveBeenCalled();
    await app.close();
  });

  it("reschedules the interview and records the comm (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "reschedule", newDate: "2026-08-05", newTime: "14:30" } });
    expect(r.statusCode).toBe(201);
    expect(H.reschedule).toHaveBeenCalledOnce();
    expect(H.insertComm).toHaveBeenCalledOnce();
    await app.close();
  });

  it("cancels the interview and records the comm (201)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "cancel" } });
    expect(r.statusCode).toBe(201);
    expect(H.cancel).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks any comm on an already-cancelled interview (409)", async () => {
    H.findInterview.mockResolvedValue(ivRow({ status: "cancelled" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "reminder" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INTERVIEW_NOT_COMMABLE");
    await app.close();
  });

  it("maps a version conflict on reschedule to 409", async () => {
    H.reschedule.mockResolvedValue(false);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "reschedule", newDate: "2026-08-05", newTime: "14:30" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("VERSION_CONFLICT");
    await app.close();
  });

  it("404 for a missing interview", async () => {
    H.findInterview.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(), payload: { type: "invite" } });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("forbids a non-HR role (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(["employee"]), payload: { type: "invite" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("lists the comms log (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/comms`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/interviews/${IV}/comms` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
