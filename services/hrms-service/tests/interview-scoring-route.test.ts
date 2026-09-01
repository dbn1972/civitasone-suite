/**
 * Interview panel scoring routes — template config, independent submission with
 * validation + one-shot lock, blind visibility, and weighted consolidation.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-1111-4000-8000-000000000e11";
const IV = "cccccccc-0000-4000-8000-00000000e011";
const I1 = "11111111-0000-4000-8000-000000000011";
const I2 = "22222222-0000-4000-8000-000000000022";
const I3 = "33333333-0000-4000-8000-000000000033";
const HRADM = "99999999-0000-4000-8000-000000000099";

const H = vi.hoisted(() => ({
  findIvMock: vi.fn(), updateIvMock: vi.fn(), findScoreMock: vi.fn(), listScoresMock: vi.fn(), insertScoreMock: vi.fn(),
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
vi.mock("../src/modules/recruitment/interview-scoring-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findInterview: (...a: unknown[]) => H.findIvMock(...a),
  updateInterview: (...a: unknown[]) => H.updateIvMock(...a),
  findScore: (...a: unknown[]) => H.findScoreMock(...a),
  listScores: (...a: unknown[]) => H.listScoresMock(...a),
  insertScore: (...a: unknown[]) => H.insertScoreMock(...a),
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

const TEMPLATE = [{ competency: "technical", weight: 60, maxScore: 10 }, { competency: "communication", weight: 40, maxScore: 10 }];
const auth = (sub: string, roles: string[]) => ({ authorization: `Bearer ${signToken({ sub, tid: TENANT, roles, sid: "s" }, SECRET)}` });
const iv = (over = {}) => ({ id: IV, tenantId: TENANT, panelMembers: [I1, I2, I3], scorecardTemplate: TEMPLATE, cutoffScore: 65, consolidatedAt: null, recommendation: null, panelScore: null, status: "scheduled", version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findIvMock.mockResolvedValue(iv());
  H.updateIvMock.mockResolvedValue(undefined);
  H.findScoreMock.mockResolvedValue(null);
  H.listScoresMock.mockResolvedValue([]);
  H.insertScoreMock.mockResolvedValue(undefined);
});
afterAll(async () => { await sqlClient.end(); });

describe("interview scoring routes", () => {
  it("configures the scorecard template with a cut-off", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "PATCH", url: `/v1/hrms/interviews/${IV}/scorecard-template`, headers: auth(HRADM, ["hr_admin"]),
      payload: { competencies: TEMPLATE, cutoffScore: 65 } });
    expect(r.statusCode).toBe(200);
    await app.close();
  });

  it("validates the score against the template (unknown competency / over max)", async () => {
    const app = await buildApp();
    const unknown = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(I1, ["interviewer"]), payload: { scores: { bogus: 5 } } });
    expect(unknown.json().code).toBe("UNKNOWN_COMPETENCY");
    const over = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(I1, ["interviewer"]), payload: { scores: { technical: 99 } } });
    expect(over.json().code).toBe("SCORE_OUT_OF_RANGE");
    await app.close();
  });

  it("rejects a non-panelist and accepts a panel member once (locks re-submit)", async () => {
    const app = await buildApp();
    const outsider = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth("88888888-0000-4000-8000-000000000088", ["interviewer"]), payload: { scores: { technical: 8 } } });
    expect(outsider.statusCode).toBe(403);
    const ok = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(I1, ["interviewer"]), payload: { scores: { technical: 8, communication: 6 }, comments: "solid" } });
    expect(ok.statusCode).toBe(201);
    expect(H.insertScoreMock).toHaveBeenCalledOnce();
    // re-submit blocked
    H.findScoreMock.mockResolvedValue({ interviewerId: I1, submitted: true });
    const dup = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(I1, ["interviewer"]), payload: { scores: { technical: 9, communication: 7 } } });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe("ALREADY_SUBMITTED");
    await app.close();
  });

  it("blinds other scores from a panel member who has not submitted; shows all after / to admin", async () => {
    H.listScoresMock.mockResolvedValue([
      { interviewerId: I1, submitted: true, scores: { technical: 8 } },
      { interviewerId: I2, submitted: true, scores: { technical: 6 } },
    ]);
    const app = await buildApp();
    // I3 is a panelist who has not submitted -> blinded, sees nothing
    const blind = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(I3, ["interviewer"]) });
    expect(blind.json().blinded).toBe(true);
    expect(blind.json().data).toHaveLength(0);
    // I1 has submitted -> sees all
    const open = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(I1, ["interviewer"]) });
    expect(open.json().blinded).toBe(false);
    expect(open.json().data).toHaveLength(2);
    // HR admin (not a panelist) -> sees all
    const admin = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(HRADM, ["hr_admin"]) });
    expect(admin.json().data).toHaveLength(2);
    await app.close();
  });

  it("denies raw scores to a non-panelist non-HR viewer (no fail-open leak)", async () => {
    H.listScoresMock.mockResolvedValue([{ interviewerId: I1, submitted: true, scores: { technical: 8 } }]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth("88888888-0000-4000-8000-000000000088", ["interviewer"]) });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("NOT_ON_PANEL");
    await app.close();
  });

  it("blocks panel-result for a panelist who has not submitted (R-RA-0147)", async () => {
    H.listScoresMock.mockResolvedValue([{ interviewerId: I1, submitted: true, scores: { technical: 8, communication: 6 } }]);
    const app = await buildApp();
    // I3 is a panelist who has not submitted -> cannot peek at the aggregate
    const blocked = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/panel-result`, headers: auth(I3, ["interviewer"]) });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("SCORE_FIRST");
    // a pure HR reviewer (not a panelist) can view it
    const hr = await injectF3(app, { method: "GET", url: `/v1/hrms/interviews/${IV}/panel-result`, headers: auth(HRADM, ["hr_admin"]) });
    expect(hr.statusCode).toBe(200);
    await app.close();
  });

  it("requires every competency to be scored (no partial scorecard)", async () => {
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/scores`, headers: auth(I1, ["interviewer"]), payload: { scores: { communication: 10 } } });
    expect(r.statusCode).toBe(400);
    expect(r.json().code).toBe("INCOMPLETE_SCORECARD");
    await app.close();
  });

  it("consolidates the weighted panel score and records the recommendation", async () => {
    H.listScoresMock.mockResolvedValue([
      { interviewerId: I1, submitted: true, scores: { technical: 8, communication: 6 } },
      { interviewerId: I2, submitted: true, scores: { technical: 6, communication: 8 } },
    ]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/consolidate`, headers: auth(HRADM, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ weightedScore: 70, passed: true, recommendation: "hire" });
    expect(H.updateIvMock.mock.calls[0][3]).toMatchObject({ panelScore: 70, recommendation: "hire", status: "completed" });
    await app.close();
  });

  it("refuses to consolidate with no submitted scores", async () => {
    H.listScoresMock.mockResolvedValue([]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/interviews/${IV}/consolidate`, headers: auth(HRADM, ["hr_admin"]), payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NO_SCORES");
    await app.close();
  });
});
