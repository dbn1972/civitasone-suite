/**
 * Interview panel governance routes — constitute panel with COI, recuse, and the
 * COI-gated outcome (recommend / waitlist / reject).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-6666-4000-8000-000000000a66";
const USER = "aaaaaaaa-7777-4000-8000-000000000a66";
const IV = "dddddddd-6666-4000-8000-00000000d066";
const CHAIR = "11111111-6666-4000-8000-000000000001";
const M1 = "11111111-6666-4000-8000-000000000002";
const COIP = "11111111-6666-4000-8000-000000000003";

const H = vi.hoisted(() => ({
  findInterview: vi.fn(), updateInterview: vi.fn(), setPanelists: vi.fn(), listPanelists: vi.fn(), recusePanelist: vi.fn(),
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
vi.mock("../src/modules/recruitment/panel-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findInterview: (...a: unknown[]) => H.findInterview(...a),
  updateInterview: (...a: unknown[]) => H.updateInterview(...a),
  setPanelists: (...a: unknown[]) => H.setPanelists(...a),
  listPanelists: (...a: unknown[]) => H.listPanelists(...a),
  recusePanelist: (...a: unknown[]) => H.recusePanelist(...a),
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

const auth = { authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const interview = (over = {}) => ({ id: IV, tenantId: TENANT, outcomeStatus: "pending", version: 1, ...over });
const panelist = (over = {}) => ({ memberId: M1, memberName: "M", panelRole: "member", coiDeclared: false, coiType: "none", recused: false, ...over });
const futureIso = new Date(Date.now() + 30 * 86400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  H.findInterview.mockResolvedValue(interview());
  H.setPanelists.mockResolvedValue(undefined);
  H.updateInterview.mockResolvedValue(undefined);
  H.recusePanelist.mockResolvedValue(1);
  H.listPanelists.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("interview panel governance routes", () => {
  it("constitutes a panel and reports readiness (201)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth, payload: {
      members: [
        { memberId: CHAIR, memberName: "Chair", panelRole: "chair" },
        { memberId: M1, memberName: "Member" },
      ],
    } });
    expect(r.statusCode).toBe(201);
    expect(r.json().readiness.ready).toBe(true);
    expect(H.setPanelists).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a declared COI without a type (422)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth, payload: {
      members: [{ memberId: CHAIR, memberName: "Chair", panelRole: "chair", coiDeclared: true, coiType: "none" }],
    } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("COI_TYPE_REQUIRED");
    await app.close();
  });

  it("refuses to change the panel after an outcome is recorded (409)", async () => {
    H.findInterview.mockResolvedValue(interview({ outcomeStatus: "recommended" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/panel`, headers: auth, payload: { members: [{ memberId: CHAIR, memberName: "C", panelRole: "chair" }] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("OUTCOME_RECORDED");
    await app.close();
  });

  it("blocks an outcome while a conflicted panelist is un-recused (409 COI_UNRESOLVED)", async () => {
    H.listPanelists.mockResolvedValue([
      panelist({ memberId: CHAIR, panelRole: "chair" }),
      panelist({ memberId: COIP, coiDeclared: true, coiType: "relative" }),
    ]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth, payload: { status: "recommended", validUntil: futureIso } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("COI_UNRESOLVED");
    expect(H.updateInterview).not.toHaveBeenCalled();
    await app.close();
  });

  it("records a recommendation once the panel is clean (200)", async () => {
    H.listPanelists.mockResolvedValue([panelist({ memberId: CHAIR, panelRole: "chair" }), panelist()]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth, payload: { status: "recommended", validUntil: futureIso } });
    expect(r.statusCode).toBe(200);
    expect(r.json().outcomeStatus).toBe("recommended");
    const patch = H.updateInterview.mock.calls[0][3] as { outcomeStatus: string; recommendationValidUntil: string };
    expect(patch.outcomeStatus).toBe("recommended");
    expect(patch.recommendationValidUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await app.close();
  });

  it("requires a rejection reason for a rejection (422)", async () => {
    H.listPanelists.mockResolvedValue([panelist({ memberId: CHAIR, panelRole: "chair" })]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/outcome`, headers: auth, payload: { status: "rejected" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("INVALID_OUTCOME");
    await app.close();
  });

  it("recuses a panelist (200)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/panelists/${COIP}/recuse`, headers: auth, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().recused).toBe(true);
    expect(H.recusePanelist).toHaveBeenCalledOnce();
    await app.close();
  });

  it("refuses to recuse after an outcome is recorded (409) — no post-decision tampering", async () => {
    H.findInterview.mockResolvedValue(interview({ outcomeStatus: "rejected" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/panelists/${COIP}/recuse`, headers: auth, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("OUTCOME_RECORDED");
    expect(H.recusePanelist).not.toHaveBeenCalled();
    await app.close();
  });
});
