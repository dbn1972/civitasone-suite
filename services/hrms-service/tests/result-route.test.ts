/**
 * Assessment result-finalisation routes — anonymised manual evaluation,
 * consolidation, maker-checker moderation, and the freeze -> publish gate.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-4444-4000-8000-000000000a44";
const MAKER = "aaaaaaaa-7777-4000-8000-000000000a44";
const CHECKER = "aaaaaaaa-9999-4000-8000-000000000a44";
const BP = "bbbbbbbb-4444-4000-8000-00000000b044";
const SCH = "dddddddd-4444-4000-8000-00000000d044";
const ATT = "eeeeeeee-4444-4000-8000-00000000e044";
const M1 = "11111111-4444-4000-8000-000000000001"; // mcq
const D1 = "11111111-4444-4000-8000-000000000002"; // descriptive

const H = vi.hoisted(() => ({
  findAttempt: vi.fn(), updateAttempt: vi.fn(), findSchedule: vi.fn(), listResponses: vi.fn(),
  findBlueprint: vi.fn(),
  saveEvaluation: vi.fn(), listEvaluations: vi.fn(), insertResultEvent: vi.fn(), listResultEvents: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/attempt-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findAttempt: (...a: unknown[]) => H.findAttempt(...a),
  updateAttempt: (...a: unknown[]) => H.updateAttempt(...a),
  findSchedule: (...a: unknown[]) => H.findSchedule(...a),
  listResponses: (...a: unknown[]) => H.listResponses(...a),
}));
vi.mock("../src/modules/recruitment/blueprint-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findBlueprint: (...a: unknown[]) => H.findBlueprint(...a),
}));
vi.mock("../src/modules/recruitment/result-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  saveEvaluation: (...a: unknown[]) => H.saveEvaluation(...a),
  listEvaluations: (...a: unknown[]) => H.listEvaluations(...a),
  insertResultEvent: (...a: unknown[]) => H.insertResultEvent(...a),
  listResultEvents: (...a: unknown[]) => H.listResultEvents(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const tok = (sub: string) => `Bearer ${signToken({ sub, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}`;
const authMaker = { authorization: tok(MAKER) };
const authChecker = { authorization: tok(CHECKER) };

const paper = [
  { questionId: M1, section: "s", marks: 10, qtype: "mcq", stem: "m", options: [{ id: "a" }, { id: "b" }], answerKey: { correct: ["b"] } },
  { questionId: D1, section: "s", marks: 20, qtype: "descriptive", stem: "essay", options: [], answerKey: { rubricRef: "r" } },
];
const schedule = () => ({ id: SCH, tenantId: TENANT, blueprintId: BP, status: "closed", paper });
const blueprint = () => ({ id: BP, tenantId: TENANT, scoringConfig: { totalCutoffPct: 40, sections: [{ key: "s", sectionCutoffPct: 0 }] } });
const attempt = (over = {}) => ({
  id: ATT, tenantId: TENANT, scheduleId: SCH, blueprintId: BP, candidateId: "candidate-x", status: "evaluated",
  needsManualEval: true, result: "withheld", version: 1, sectionScores: { s: { score: 10, max: 30 } },
  rawTotalScore: null, maxScore: "30.00", moderation: {}, moderatedBy: null, frozen: false, published: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.findSchedule.mockResolvedValue(schedule());
  H.findBlueprint.mockResolvedValue(blueprint());
  H.listResponses.mockResolvedValue([{ questionId: M1, response: { selected: ["b"] } }]);
  H.listEvaluations.mockResolvedValue([]);
  H.updateAttempt.mockResolvedValue(undefined);
  H.saveEvaluation.mockResolvedValue(undefined);
  H.insertResultEvent.mockResolvedValue(undefined);
  H.listResultEvents.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("assessment result finalisation routes", () => {
  it("serves an anonymised manual-evaluation queue (no candidate identity)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/assessments/attempts/${ATT}/manual-queue`, headers: authMaker });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.questions).toHaveLength(1); // only the descriptive
    expect(body.questions[0].questionId).toBe(D1);
    expect(JSON.stringify(body)).not.toContain("candidate-x"); // blind
    await app.close();
  });

  it("rejects manual scoring of an objective question (422) and an over-max score (422)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    const app = await buildApp();
    const obj = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/evaluations`, headers: authMaker, payload: { questionId: M1, score: 5 } });
    expect(obj.statusCode).toBe(422);
    expect(obj.json().code).toBe("NOT_MANUAL");
    const over = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/evaluations`, headers: authMaker, payload: { questionId: D1, score: 25 } });
    expect(over.statusCode).toBe(422);
    expect(over.json().code).toBe("SCORE_TOO_HIGH");
    await app.close();
  });

  it("records a manual evaluator score (200)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/evaluations`, headers: authMaker, payload: { questionId: D1, score: 15, remarks: "good" } });
    expect(r.statusCode).toBe(200);
    expect(H.saveEvaluation).toHaveBeenCalledOnce();
    await app.close();
  });

  it("blocks consolidation while a manual question is unscored (422)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    H.listEvaluations.mockResolvedValue([]); // d1 not evaluated
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/consolidate`, headers: authMaker, payload: {} });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("PENDING_EVALUATION");
    await app.close();
  });

  it("consolidates objective + manual into a final result (200)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    H.listEvaluations.mockResolvedValue([{ questionId: D1, score: "15" }]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/consolidate`, headers: authMaker, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().totalScore).toBe(25); // mcq 10 + manual 15
    expect(r.json().result).toBe("qualified"); // 25/30 = 83% >= 40%
    await app.close();
  });

  it("moderation is maker-checker: proposer cannot approve their own (403 SoD)", async () => {
    // proposed by MAKER
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: false, rawTotalScore: "25.00", moderation: { method: "scale", factor: 1.1, proposedBy: MAKER } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/moderate/approve`, headers: authMaker, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    expect(H.updateAttempt).not.toHaveBeenCalled();
    await app.close();
  });

  it("applies moderation when approved by an independent checker (200)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: false, result: "qualified", rawTotalScore: "25.00", sectionScores: { s: { score: 25, max: 30 } }, moderation: { method: "scale", factor: 1.1, proposedBy: MAKER } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/moderate/approve`, headers: authChecker, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().totalScore).toBe(27.5); // 25 * 1.1
    await app.close();
  });

  it("re-consolidation invalidates a prior applied moderation (clears it + audits)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: true, moderatedBy: CHECKER, moderation: { method: "scale", factor: 1.1, proposedBy: MAKER, approvedBy: CHECKER } }));
    H.listEvaluations.mockResolvedValue([{ questionId: D1, score: "15" }]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/consolidate`, headers: authMaker, payload: {} });
    expect(r.statusCode).toBe(200);
    const patch = H.updateAttempt.mock.calls[0][3] as { moderation: unknown; moderatedBy: unknown };
    expect(patch.moderation).toEqual({});
    expect(patch.moderatedBy).toBeNull();
    const actions = H.insertResultEvent.mock.calls.map((c) => (c[1] as { action: string }).action);
    expect(actions).toContain("moderation_reset");
    await app.close();
  });

  it("blocks the moderation approver from also freezing the result (403 SoD)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: false, result: "qualified", moderatedBy: CHECKER, moderation: { method: "scale", factor: 1.1, proposedBy: MAKER, approvedBy: CHECKER } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/freeze`, headers: authChecker, payload: {} });
    expect(r.statusCode).toBe(403);
    expect(r.json().code).toBe("SOD_VIOLATION");
    await app.close();
  });

  it("restricts the identity-bearing result view to senior roles (hr_officer 403)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    const officer = { authorization: `Bearer ${signToken({ sub: MAKER, tid: TENANT, roles: ["hr_officer"], sid: "s" }, SECRET)}` };
    const app = await buildApp();
    const denied = await app.inject({ method: "GET", url: `/v1/hrms/assessments/attempts/${ATT}/result`, headers: officer });
    expect(denied.statusCode).toBe(403);
    const ok = await app.inject({ method: "GET", url: `/v1/hrms/assessments/attempts/${ATT}/result`, headers: authMaker });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("cannot freeze with an unapproved moderation proposal (409)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: false, result: "qualified", moderation: { method: "scale", factor: 1.1, proposedBy: MAKER } }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/freeze`, headers: authChecker, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("MODERATION_PENDING");
    await app.close();
  });

  it("publish is gated on freeze: cannot publish an unfrozen result (409)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: false, result: "qualified", frozen: false }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/publish`, headers: authMaker, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("NOT_FROZEN");
    await app.close();
  });

  it("freezes then publishes an authorised result (200 -> 200)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: false, result: "qualified", moderation: {} }));
    const app = await buildApp();
    const fr = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/freeze`, headers: authChecker, payload: {} });
    expect(fr.statusCode).toBe(200);
    expect(fr.json().frozen).toBe(true);
    // now frozen
    H.findAttempt.mockResolvedValue(attempt({ needsManualEval: false, result: "qualified", frozen: true }));
    const pub = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/publish`, headers: authChecker, payload: {} });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().published).toBe(true);
    await app.close();
  });

  it("locks evaluations once frozen (409)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ frozen: true }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/evaluations`, headers: authMaker, payload: { questionId: D1, score: 15 } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("FROZEN");
    await app.close();
  });
});
