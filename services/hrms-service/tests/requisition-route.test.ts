/**
 * Recruitment requisition route wiring — create, approval-chain advance + role
 * gate, return-with-history, publication gate (R-RA-0056), clone, and
 * confidential visibility (R-RA-0058).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";
import { DEFAULT_GOVT_CHAIN } from "../src/modules/recruitment/requisition-domain.js";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-0000000000f1";
const USER = "aaaaaaaa-7777-4000-8000-0000000000f1";
const OTHER = "aaaaaaaa-7777-4000-8000-0000000000f2";
const REQ = "dddddddd-0000-4000-8000-00000000000d";
const DEPT = "eeeeeeee-0000-4000-8000-00000000000e";

const H = vi.hoisted(() => ({
  findReqMock: vi.fn(),
  insertReqMock: vi.fn(),
  updateReqMock: vi.fn(),
  insertApprovalMock: vi.fn(),
  insertJobOpeningMock: vi.fn(),
  actorApprovedMock: vi.fn(),
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
vi.mock("../src/modules/recruitment/requisition-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertRequisition: (...a: unknown[]) => H.insertReqMock(...a),
  findRequisition: (...a: unknown[]) => H.findReqMock(...a),
  updateRequisition: (...a: unknown[]) => H.updateReqMock(...a),
  insertApproval: (...a: unknown[]) => H.insertApprovalMock(...a),
  insertJobOpening: (...a: unknown[]) => H.insertJobOpeningMock(...a),
  actorAlreadyApproved: (...a: unknown[]) => H.actorApprovedMock(...a),
  listRequisitions: async () => [],
  listApprovals: async () => [],
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

const auth = (roles: string[], sub = USER) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}` });

function reqRow(over: Record<string, unknown> = {}) {
  return {
    id: REQ, tenantId: TENANT, requisitionNo: "REQ-ABCD1234", title: "Engineer",
    departmentId: DEPT, designationId: null, employmentType: "permanent", recruitmentMode: "direct",
    campaignType: "direct", vacancies: 2, reason: "expansion", qualification: "B.Tech", location: "HQ",
    reservation: { OBC: 1 }, confidential: false, approvalChain: DEFAULT_GOVT_CHAIN, currentStage: -1,
    status: "draft", approvedAt: null, createdBy: USER, version: 1, ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  H.insertReqMock.mockResolvedValue(undefined);
  H.updateReqMock.mockResolvedValue(undefined);
  H.insertApprovalMock.mockResolvedValue(undefined);
  H.insertJobOpeningMock.mockResolvedValue(undefined);
  H.actorApprovedMock.mockResolvedValue(false);
});
afterAll(async () => { await sqlClient.end(); });

describe("recruitment requisition routes", () => {
  it("creates a draft requisition (201)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: "/v1/hrms/requisitions", headers: auth(["hr_admin"]),
      payload: { title: "Engineer", departmentId: DEPT, vacancies: 2, recruitmentMode: "deputation", campaignType: "campus", reservation: { OBC: 1 } } });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("draft");
    expect(H.insertReqMock).toHaveBeenCalledOnce();
    await app.close();
  });

  it("submits a draft into the approval chain at stage 0", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "draft" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/submit`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "pending_approval", currentStage: 0 });
    await app.close();
  });

  it("advances the chain only for the stage's configured role; logs the approval", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "pending_approval", currentStage: 0 })); // stage 0 = hiring_manager
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/approve`, headers: auth(["hiring_manager"], OTHER), payload: { comments: "ok" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().currentStage).toBe(1);
    expect(H.insertApprovalMock.mock.calls[0][1].action).toBe("approve");
    await app.close();
  });

  it("blocks the creator from approving their own requisition (409 SOD)", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "pending_approval", currentStage: 0, createdBy: USER }));
    const app = await buildApp();
    // approver holds the stage role but IS the creator (USER)
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/approve`, headers: auth(["hiring_manager"], USER), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("blocks the same person from clearing a second stage (409 SOD)", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "pending_approval", currentStage: 1, createdBy: USER }));
    H.actorApprovedMock.mockResolvedValue(true); // OTHER already approved an earlier stage
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/approve`, headers: auth(["hr_admin"], OTHER), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("forbids a non-admin from supplying a custom approval chain (403)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: "/v1/hrms/requisitions", headers: auth(["hiring_manager"]),
      payload: { title: "X", departmentId: DEPT, approvalChain: [{ stage: "Self", role: "hiring_manager" }] } });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("CHAIN_NOT_ALLOWED");
    expect(H.insertReqMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("lets an HR admin set a valid diverse custom chain (201) but rejects a rubber-stamp all-same-role chain (400)", async () => {
    const app = await buildApp();
    const ok = await injectF3(app, { method: "POST", url: "/v1/hrms/requisitions", headers: auth(["hr_admin"]),
      payload: { title: "X", departmentId: DEPT, approvalChain: [{ stage: "HM", role: "hiring_manager" }, { stage: "HR", role: "hr_admin" }] } });
    expect(ok.statusCode).toBe(201);
    const bad = await injectF3(app, { method: "POST", url: "/v1/hrms/requisitions", headers: auth(["hr_admin"]),
      payload: { title: "X", departmentId: DEPT, approvalChain: [{ stage: "HR1", role: "hr_admin" }, { stage: "HR2", role: "hr_admin" }] } });
    expect(bad.statusCode).toBe(400);
    const badRole = await injectF3(app, { method: "POST", url: "/v1/hrms/requisitions", headers: auth(["hr_admin"]),
      payload: { title: "X", departmentId: DEPT, approvalChain: [{ stage: "Z", role: "intern" }] } });
    expect(badRole.statusCode).toBe(400);
    expect(badRole.json().code).toBe("INVALID_CHAIN_ROLE");
    await app.close();
  });

  it("rejects approval by a role that is not the current stage (403)", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "pending_approval", currentStage: 0 })); // needs hiring_manager
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/approve`, headers: auth(["hr_officer"]), payload: {} });
    expect(r.statusCode).toBe(403);
    expect(H.updateReqMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("marks approved when the final stage approves", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "pending_approval", currentStage: 3 })); // last = competent_authority
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/approve`, headers: auth(["competent_authority"], OTHER), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("approved");
    expect(H.updateReqMock.mock.calls[0][3].status).toBe("approved");
    await app.close();
  });

  it("returns for correction with mandatory comments and records history", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "pending_approval", currentStage: 1 })); // stage 1 = hr_admin
    const app = await buildApp();
    const noComment = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/return`, headers: auth(["hr_admin"]), payload: {} });
    expect(noComment.statusCode).toBe(400); // comments mandatory
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/return`, headers: auth(["hr_admin"]), payload: { comments: "fix grade" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("returned");
    expect(H.insertApprovalMock.mock.calls[0][1].action).toBe("return");
    await app.close();
  });

  it("blocks publication until fully approved (R-RA-0056)", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "pending_approval" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/publish`, headers: auth(["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_APPROVED");
    expect(H.insertJobOpeningMock).not.toHaveBeenCalled();
    await app.close();
  });

  it("publishes an approved requisition into a job opening", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "approved", departmentId: DEPT }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/publish`, headers: auth(["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("published");
    expect(H.insertJobOpeningMock).toHaveBeenCalledOnce();
    expect(H.updateReqMock.mock.calls[0][3].status).toBe("published");
    await app.close();
  });

  it("clones a requisition into a fresh draft", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ status: "published" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/requisitions/${REQ}/clone`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(201);
    expect(r.json().status).toBe("draft");
    const inserted = H.insertReqMock.mock.calls[0][1];
    expect(inserted.status).toBe("draft");
    expect(inserted.title).toBe("Engineer");
    await app.close();
  });

  it("hides a confidential requisition from a non-privileged non-creator (404)", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ confidential: true, createdBy: OTHER }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/requisitions/${REQ}`, headers: auth(["hr_officer"]) });
    expect(r.statusCode).toBe(404);
    await app.close();
  });

  it("shows a confidential requisition to an HR admin", async () => {
    H.findReqMock.mockResolvedValue(reqRow({ confidential: true, createdBy: OTHER }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/requisitions/${REQ}`, headers: auth(["hr_admin"]) });
    expect(r.statusCode).toBe(200);
    await app.close();
  });
});
