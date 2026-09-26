/**
 * R-RA-0111 — screening override maker-checker routes.
 * repos + shared/db mocked; real route wiring + RBAC + SoD run.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-bbbb-4000-8000-00000000bbaa";
const REQUESTER = "11111111-bbbb-4000-8000-00000000bb11";
const SCREENER = "22222222-bbbb-4000-8000-00000000bb22";
const APPROVER = "33333333-bbbb-4000-8000-00000000bb33";
const APP = "dddddddd-bbbb-4000-8000-0000000dbbaa";
const REQ = "eeeeeeee-bbbb-4000-8000-0000000ebbaa";
const JOB = "ffffffff-bbbb-4000-8000-0000000fbbaa";

const H = vi.hoisted(() => ({
  findApplication: vi.fn(), setScreening: vi.fn(), insertEvent: vi.fn(),
  createRequest: vi.fn(), findRequest: vi.fn(), findPending: vi.fn(),
  listForApp: vi.fn(), setRequestStatus: vi.fn(), setRequestStatusIfPending: vi.fn(),
}));

vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: async () => undefined }));
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
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findApplication(...a),
  findApplicationTx: (_tx: unknown, ...a: unknown[]) => H.findApplication(...a),
  setScreening: (...a: unknown[]) => H.setScreening(...a),
  insertEvent: (...a: unknown[]) => H.insertEvent(...a),
}));
vi.mock("../src/modules/recruitment/screening-override-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  createRequest: (...a: unknown[]) => H.createRequest(...a),
  findRequest: (...a: unknown[]) => H.findRequest(...a),
  findRequestTx: (_tx: unknown, ...a: unknown[]) => H.findRequest(...a),
  findPendingForApplication: (...a: unknown[]) => H.findPending(...a),
  listForApplication: (...a: unknown[]) => H.listForApp(...a),
  setRequestStatus: (...a: unknown[]) => H.setRequestStatus(...a),
  setRequestStatusIfPending: (...a: unknown[]) => H.setRequestStatusIfPending(...a),
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

const tok = (sub: string, roles: string[]) => signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET);
const hdr = (sub: string, roles: string[]) => ({ authorization: `Bearer ${tok(sub, roles)}` });
const appRow = (over = {}) => ({ id: APP, tenantId: TENANT, jobOpeningId: JOB, screeningDecision: "ineligible", shortlistFrozen: false, screenedBy: SCREENER, version: 3, ...over });
const reqRow = (over = {}) => ({ id: REQ, tenantId: TENANT, applicationId: APP, jobOpeningId: JOB, fromDecision: "ineligible", toDecision: "eligible", applicationVersion: 3, reasonCode: null, reason: "docs re-verified", status: "pending", originalScreenedBy: SCREENER, requestedBy: REQUESTER, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findApplication.mockResolvedValue(appRow());
  H.findPending.mockResolvedValue(null);
  H.createRequest.mockResolvedValue(undefined);
  H.findRequest.mockResolvedValue(reqRow());
  H.setScreening.mockResolvedValue(undefined);
  H.insertEvent.mockResolvedValue(undefined);
  H.setRequestStatus.mockResolvedValue(undefined);
  H.setRequestStatusIfPending.mockResolvedValue(true);
  H.listForApp.mockResolvedValue([reqRow()]);
});
afterAll(async () => { await sqlClient.end(); });

describe("screening override maker-checker (R-RA-0111)", () => {
  it("requests an override (201, pending) as an admin", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_admin"]), payload: { toDecision: "eligible", reason: "docs re-verified" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("pending");
    expect(H.createRequest).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids an hr_officer (non-admin) from requesting (403)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_officer"]), payload: { toDecision: "eligible", reason: "x" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("rejects an override on a pending application (422)", async () => {
    H.findApplication.mockResolvedValue(appRow({ screeningDecision: "pending", screenedBy: null }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_admin"]), payload: { toDecision: "eligible", reason: "x" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_OVERRIDE");
    await app.close();
  });

  it("rejects a duplicate pending request (409 OVERRIDE_PENDING)", async () => {
    H.findPending.mockResolvedValue(reqRow());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_admin"]), payload: { toDecision: "eligible", reason: "x" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("OVERRIDE_PENDING");
    await app.close();
  });

  it("approves + applies the override as an independent admin (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: { note: "reviewed" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "approved", screeningDecision: "eligible" });
    expect(H.setScreening).toHaveBeenCalledOnce();
    expect(H.insertEvent).toHaveBeenCalledOnce();
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override" }));
    expect(H.setRequestStatusIfPending).toHaveBeenCalledOnce();
    await app.close();
  });

  // R-RA-0111: the atomic guard, not the upfront pre-check -- these mock the
  // DB-level race outcome directly (setRequestStatusIfPending / setScreening
  // rejecting), since a real concurrent race isn't expressible through fixed
  // sequential mocks. The genuine concurrent proof is
  // screening-override-decision-race.test.ts (real Postgres, real Promise.all).
  it("loses the atomic race on approve when another checker decided first (409 NOT_PENDING, audited)", async () => {
    H.setRequestStatusIfPending.mockResolvedValue(false);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    // Never applied the decision, and never marked "approved" -- both sides
    // win together or not at all.
    expect(H.setScreening).not.toHaveBeenCalled();
    // But the denial itself left a trace, exactly like a synchronous 409 does.
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override_denied", isOverride: true }));
    await app.close();
  });

  it("loses the atomic race on approve when the application went stale between the read and the write (409 STALE_OVERRIDE, audited)", async () => {
    H.setRequestStatusIfPending.mockResolvedValue(true);
    H.setScreening.mockRejectedValue(new Error("VERSION_CONFLICT"));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("STALE_OVERRIDE");
    // The override-request side "won" its own guard but must not stick if the
    // application side then failed -- the route must not have recorded a
    // normal "override" event for a decision that was never actually applied.
    expect(H.insertEvent).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override" }));
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override_denied", isOverride: true }));
    await app.close();
  });

  it("blocks the requester from approving their own override (403 SOD_VIOLATION)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(REQUESTER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.setScreening).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks the original screener from approving (403 SOD_VIOLATION)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(SCREENER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("rejects a stale override when the decision moved on (409 STALE_OVERRIDE, audited)", async () => {
    H.findApplication.mockResolvedValue(appRow({ screeningDecision: "shortlisted" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("STALE_OVERRIDE");
    // This is the FAST-PATH staleness check (not the atomic race-loss path
    // above) -- under real racing this is reached just as often as the atomic
    // path, so it must leave the identical audit trace, not a silent 409.
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override_denied", isOverride: true }));
    await app.close();
  });

  it("catches an A→B→A cycle as stale via the version pin (409 STALE_OVERRIDE, audited)", async () => {
    // Same decision value as raised against, but the version advanced.
    H.findApplication.mockResolvedValue(appRow({ screeningDecision: "ineligible", version: 5 }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("STALE_OVERRIDE");
    expect(H.setScreening).not.toHaveBeenCalled();
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override_denied", isOverride: true }));
    await app.close();
  });

  it("blocks approval when the CURRENT screener is the approver even if request snapshot differs (403)", async () => {
    // request was raised with originalScreenedBy=SCREENER, but the current author is APPROVER
    H.findApplication.mockResolvedValue(appRow({ screenedBy: APPROVER }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("lets the requester cancel their own pending request (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/cancel`, headers: hdr(REQUESTER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("cancelled");
    expect(H.setRequestStatus).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids a different admin from cancelling someone else's request (403)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/cancel`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_REQUESTER");
    await app.close();
  });

  it("rejects approving a non-pending request via the fast path (409 NOT_PENDING, audited)", async () => {
    H.findRequest.mockResolvedValue(reqRow({ status: "approved" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    // This is the FAST-PATH isActionable check (mustReq's status is already
    // non-pending before the atomic transaction is ever attempted) -- under
    // real racing this is reached just as often as the atomic race-loss path
    // above, so it must leave the identical audit trace.
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override_denied", isOverride: true }));
    await app.close();
  });

  it("rejects an override as a different admin (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/reject`, headers: hdr(APPROVER, ["hr_admin"]), payload: { note: "insufficient" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    expect(H.setRequestStatusIfPending).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects rejecting a non-pending request via the fast path (409 NOT_PENDING, audited)", async () => {
    H.findRequest.mockResolvedValue(reqRow({ status: "cancelled" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/reject`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override_denied", isOverride: true }));
    await app.close();
  });

  it("loses the atomic race on reject when another checker decided first (409 NOT_PENDING, audited)", async () => {
    H.setRequestStatusIfPending.mockResolvedValue(false);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/reject`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    expect(H.insertEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "override_denied", isOverride: true }));
    await app.close();
  });

  it("blocks the requester from rejecting their own override (403)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/reject`, headers: hdr(REQUESTER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("404 when approving a request that does not exist", async () => {
    H.findRequest.mockResolvedValue(null);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("lists override requests for an application (200, any HR reader)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/applications/${APP}/screening-overrides` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
