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
  listForApp: vi.fn(), setRequestStatus: vi.fn(),
}));

vi.mock("../src/modules/recruitment/audit-emit.js", () => ({ emitAudit: async () => undefined }));
vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/modules/recruitment/screening-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findApplication: (...a: unknown[]) => H.findApplication(...a),
  setScreening: (...a: unknown[]) => H.setScreening(...a),
  insertEvent: (...a: unknown[]) => H.insertEvent(...a),
}));
vi.mock("../src/modules/recruitment/screening-override-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  createRequest: (...a: unknown[]) => H.createRequest(...a),
  findRequest: (...a: unknown[]) => H.findRequest(...a),
  findPendingForApplication: (...a: unknown[]) => H.findPending(...a),
  listForApplication: (...a: unknown[]) => H.listForApp(...a),
  setRequestStatus: (...a: unknown[]) => H.setRequestStatus(...a),
}));

import { buildApp } from "../src/app.js";
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
  H.listForApp.mockResolvedValue([reqRow()]);
});
afterAll(async () => { await sqlClient.end(); });

describe("screening override maker-checker (R-RA-0111)", () => {
  it("requests an override (201, pending) as an admin", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_admin"]), payload: { toDecision: "eligible", reason: "docs re-verified" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("pending");
    expect(H.createRequest).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids an hr_officer (non-admin) from requesting (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_officer"]), payload: { toDecision: "eligible", reason: "x" } });
    expect(r.statusCode).toBe(403);
    await app.close();
  });

  it("rejects an override on a pending application (422)", async () => {
    H.findApplication.mockResolvedValue(appRow({ screeningDecision: "pending", screenedBy: null }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_admin"]), payload: { toDecision: "eligible", reason: "x" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_OVERRIDE");
    await app.close();
  });

  it("rejects a duplicate pending request (409 OVERRIDE_PENDING)", async () => {
    H.findPending.mockResolvedValue(reqRow());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_admin"]), payload: { toDecision: "eligible", reason: "x" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("OVERRIDE_PENDING");
    await app.close();
  });

  it("approves + applies the override as an independent admin (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: { note: "reviewed" } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "approved", screeningDecision: "eligible" });
    expect(H.setScreening).toHaveBeenCalledOnce();
    expect(H.insertEvent).toHaveBeenCalledOnce();
    expect(H.setRequestStatus).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks the requester from approving their own override (403 SOD_VIOLATION)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(REQUESTER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.setScreening).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks the original screener from approving (403 SOD_VIOLATION)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(SCREENER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("rejects a stale override when the decision moved on (409 STALE_OVERRIDE)", async () => {
    H.findApplication.mockResolvedValue(appRow({ screeningDecision: "shortlisted" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("STALE_OVERRIDE");
    await app.close();
  });

  it("catches an A→B→A cycle as stale via the version pin (409 STALE_OVERRIDE)", async () => {
    // Same decision value as raised against, but the version advanced.
    H.findApplication.mockResolvedValue(appRow({ screeningDecision: "ineligible", version: 5 }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("STALE_OVERRIDE");
    expect(H.setScreening).not.toHaveBeenCalled();
    await app.close();
  });

  it("blocks approval when the CURRENT screener is the approver even if request snapshot differs (403)", async () => {
    // request was raised with originalScreenedBy=SCREENER, but the current author is APPROVER
    H.findApplication.mockResolvedValue(appRow({ screenedBy: APPROVER }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("lets the requester cancel their own pending request (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/cancel`, headers: hdr(REQUESTER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("cancelled");
    expect(H.setRequestStatus).toHaveBeenCalledOnce();
    await app.close();
  });

  it("forbids a different admin from cancelling someone else's request (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/cancel`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_REQUESTER");
    await app.close();
  });

  it("rejects approving a non-pending request (409 NOT_PENDING)", async () => {
    H.findRequest.mockResolvedValue(reqRow({ status: "approved" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_PENDING");
    await app.close();
  });

  it("rejects an override as a different admin (200)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/reject`, headers: hdr(APPROVER, ["hr_admin"]), payload: { note: "insufficient" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("rejected");
    expect(H.setRequestStatus).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks the requester from rejecting their own override (403)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/reject`, headers: hdr(REQUESTER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("404 when approving a request that does not exist", async () => {
    H.findRequest.mockResolvedValue(null);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/screening-overrides/${REQ}/approve`, headers: hdr(APPROVER, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("lists override requests for an application (200, any HR reader)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/screening-overrides`, headers: hdr(REQUESTER, ["hr_officer"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toHaveLength(1);
    await app.close();
  });

  it("requires auth (401)", async () => {
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/applications/${APP}/screening-overrides` });
    expect(r.statusCode).toBe(401);
    await app.close();
  });
});
