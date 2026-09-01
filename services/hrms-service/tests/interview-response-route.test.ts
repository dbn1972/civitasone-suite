/**
 * R-RA-0143 — candidate response + HR approve/decline routes.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-0143-4000-8000-000000000143";
const USER = "aaaaaaaa-7777-4000-8000-000000000143";
const IV = "dddddddd-0143-4000-8000-00000000d143";
const APPID = "eeeeeeee-0143-4000-8000-00000000e143";
const REQ = "ffffffff-0143-4000-8000-00000000f143";

const H = vi.hoisted(() => ({
  findInterview: vi.fn(), reschedule: vi.fn(),
  insertResponse: vi.fn(), findResponse: vi.fn(), findPending: vi.fn(), listForInterview: vi.fn(), setStatus: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => {
  // markProcessed() in the F3 consumer runs
  // insert(...).values(...).onConflictDoNothing().returning() on the tx, which a
  // bare {} cannot answer — the consumer threw before reaching any case.
  const stubTx = { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => [{ messageId: "stub" }] }) }) }) };
  return {
    ...(await io<Record<string, unknown>>()),
    db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(stubTx), insert: () => ({ values: async () => undefined }) },
  };
});
vi.mock("../src/modules/recruitment/interview-comms-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findInterview: (...a: unknown[]) => H.findInterview(...a),
  rescheduleInterview: (...a: unknown[]) => H.reschedule(...a),
}));
vi.mock("../src/modules/recruitment/interview-response-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertResponse: (...a: unknown[]) => H.insertResponse(...a),
  findResponse: (...a: unknown[]) => H.findResponse(...a),
  findPendingForInterview: (...a: unknown[]) => H.findPending(...a),
  listForInterview: (...a: unknown[]) => H.listForInterview(...a),
  setResponseStatus: (...a: unknown[]) => H.setStatus(...a),
}));

import { buildApp } from "../src/app.js";

import { queue } from "../src/shared/infra.js";
import { registerF3_recruitment_Consumers } from "../src/modules/recruitment/f3-consumer.js";

// These routes only PUBLISH; the row is written by the recruitment F3 consumer
// that f3-leftover-register.ts wires into the worker. Register it here so the
// suite exercises the whole write path instead of the HTTP layer alone.
registerF3_recruitment_Consumers(queue);
/** Await the in-memory queue's fan-out so the consumer's write has happened. */
async function drainF3(): Promise<void> {
  await (queue as unknown as import("@civitasone/queue").MemoryQueue).drain();
}
type TestApp = { inject: (opts: never) => Promise<never> };
/** inject() + drain, so an assertion never races the async F3 write. */
async function injectF3(app: TestApp, opts: unknown): Promise<never> {
  const res = await app.inject(opts as never);
  await drainF3();
  return res;
}

import { sqlClient } from "../src/shared/db.js";

const tok = (roles: string[]) => signToken({ sub: USER, tid: TENANT, roles, sid: "s" }, SECRET);
const auth = (roles = ["hr_admin"]) => ({ authorization: `Bearer ${tok(roles)}` });
const ivRow = (over = {}) => ({ id: IV, tenantId: TENANT, applicationId: APPID, scheduledDate: "2026-08-01", scheduledTime: "10:00", status: "scheduled", version: 1, ...over });
const reqRow = (over = {}) => ({ id: REQ, tenantId: TENANT, interviewId: IV, applicationId: APPID, responseType: "reschedule_request", status: "pending", preferredDate: "2026-08-20", preferredTime: "09:30", reason: "clash", version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findInterview.mockResolvedValue(ivRow());
  H.reschedule.mockResolvedValue(true);
  H.insertResponse.mockResolvedValue(undefined);
  H.findResponse.mockResolvedValue(reqRow());
  H.findPending.mockResolvedValue(null);
  H.listForInterview.mockResolvedValue([reqRow()]);
  H.setStatus.mockResolvedValue(undefined);
});
afterAll(async () => { await sqlClient.end(); });

describe("candidate interview response (R-RA-0143)", () => {
  it("records a confirm (201 confirmed)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/candidate-response`, headers: auth(["hr_officer"]), payload: { type: "confirm" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("confirmed");
    expect(H.insertResponse).toHaveBeenCalledOnce();
    await app.close();
  });

  it("records a reschedule request (201 pending)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/candidate-response`, headers: auth(), payload: { type: "reschedule_request", preferredDate: "2035-08-20", preferredTime: "09:30", reason: "exam clash" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("pending");
    await app.close();
  });

  it("rejects a reschedule request without a preferred slot (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/candidate-response`, headers: auth(), payload: { type: "reschedule_request", reason: "clash" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_RESPONSE");
    await app.close();
  });

  it("rejects a second pending reschedule request (409)", async () => {
    H.findPending.mockResolvedValue(reqRow());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/candidate-response`, headers: auth(), payload: { type: "reschedule_request", preferredDate: "2035-08-20", preferredTime: "09:30", reason: "clash" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("RESCHEDULE_PENDING");
    await app.close();
  });

  it("blocks a response on a cancelled interview (409)", async () => {
    H.findInterview.mockResolvedValue(ivRow({ status: "cancelled" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/candidate-response`, headers: auth(), payload: { type: "confirm" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("INTERVIEW_NOT_COMMABLE");
    await app.close();
  });

  it("HR approves a reschedule request and applies the slot (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interview-reschedule-requests/${REQ}/approve`, headers: auth(["hr_admin"]), payload: { note: "ok" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "approved", scheduledDate: "2026-08-20", scheduledTime: "09:30" });
    expect(H.reschedule).toHaveBeenCalledOnce();
    expect(H.setStatus).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids an hr_officer from approving (403)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interview-reschedule-requests/${REQ}/approve`, headers: auth(["hr_officer"]), payload: {} });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("rejects approving a non-pending request (409 NOT_PENDING)", async () => {
    H.findResponse.mockResolvedValue(reqRow({ status: "approved" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interview-reschedule-requests/${REQ}/approve`, headers: auth(["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    await app.close();
  });

  it("maps a version conflict on approve to 409", async () => {
    H.reschedule.mockResolvedValue(false);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interview-reschedule-requests/${REQ}/approve`, headers: auth(["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("VERSION_CONFLICT");
    await app.close();
  });

  it("HR declines a reschedule request (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interview-reschedule-requests/${REQ}/decline`, headers: auth(["hr_admin"]), payload: { note: "no slots" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("declined");
    expect(H.reschedule).not.toHaveBeenCalled();
    await app.close();
  });

  it("404 when approving a request that does not exist", async () => {
    H.findResponse.mockResolvedValue(null);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interview-reschedule-requests/${REQ}/approve`, headers: auth(["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("lists candidate responses (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/candidate-responses`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/candidate-responses` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
