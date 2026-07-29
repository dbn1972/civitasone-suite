/**
 * Assessment runtime routes — schedule assembly (section-count enforcement +
 * paper snapshot), attempt assignment, identity gate on start, answer-key-free
 * delivery, auto-save, and submit auto-evaluation.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-3333-4000-8000-000000000a33";
const USER = "aaaaaaaa-7777-4000-8000-000000000a33";
const BP = "bbbbbbbb-3333-4000-8000-00000000b033";
const SCH = "dddddddd-3333-4000-8000-00000000d033";
const ATT = "eeeeeeee-3333-4000-8000-00000000e033";
const Q1 = "11111111-3333-4000-8000-000000000001";
const Q2 = "11111111-3333-4000-8000-000000000002";

const H = vi.hoisted(() => ({
  findBlueprint: vi.fn(), findQuestion: vi.fn(),
  insertSchedule: vi.fn(), findSchedule: vi.fn(), updateSchedule: vi.fn(), listSchedules: vi.fn(),
  insertAttempt: vi.fn(), findAttempt: vi.fn(), updateAttempt: vi.fn(), listAttemptsBySchedule: vi.fn(),
  saveResponse: vi.fn(), updateResponseScore: vi.fn(), listResponses: vi.fn(),
}));

vi.mock("../src/shared/db.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb({}), insert: () => ({ values: async () => undefined }) },
}));
vi.mock("../src/modules/recruitment/blueprint-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findBlueprint: (...a: unknown[]) => H.findBlueprint(...a),
  findQuestion: (...a: unknown[]) => H.findQuestion(...a),
}));
vi.mock("../src/modules/recruitment/attempt-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertSchedule: (...a: unknown[]) => H.insertSchedule(...a),
  findSchedule: (...a: unknown[]) => H.findSchedule(...a),
  updateSchedule: (...a: unknown[]) => H.updateSchedule(...a),
  listSchedules: (...a: unknown[]) => H.listSchedules(...a),
  insertAttempt: (...a: unknown[]) => H.insertAttempt(...a),
  findAttempt: (...a: unknown[]) => H.findAttempt(...a),
  updateAttempt: (...a: unknown[]) => H.updateAttempt(...a),
  listAttemptsBySchedule: (...a: unknown[]) => H.listAttemptsBySchedule(...a),
  saveResponse: (...a: unknown[]) => H.saveResponse(...a),
  updateResponseScore: (...a: unknown[]) => H.updateResponseScore(...a),
  listResponses: (...a: unknown[]) => H.listResponses(...a),
}));

import { buildApp } from "../src/app.js";
import { sqlClient } from "../src/shared/db.js";

const auth = { authorization: `Bearer ${signToken({ sub: USER, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const activeBlueprint = (over = {}) => ({
  id: BP, tenantId: TENANT, status: "active", durationMinutes: 60,
  scoringConfig: { totalCutoffPct: 40, negativeMarking: { enabled: true, fraction: 0.25 }, sections: [{ key: "apt", questionCount: 2, sectionCutoffPct: 0 }] },
  ...over,
});
const validatedQ = (id: string) => ({ id, tenantId: TENANT, status: "validated", marks: 5, qtype: "mcq", stem: "q?", options: [{ id: "a", text: "1" }, { id: "b", text: "2" }], answerKey: { correct: ["b"] } });
const paper = [
  { questionId: Q1, section: "apt", marks: 5, qtype: "mcq", stem: "q1", options: [{ id: "a" }, { id: "b" }], answerKey: { correct: ["b"] } },
  { questionId: Q2, section: "apt", marks: 5, qtype: "mcq", stem: "q2", options: [{ id: "a" }, { id: "b" }], answerKey: { correct: ["a"] } },
];
const schedule = (over = {}) => ({
  id: SCH, tenantId: TENANT, blueprintId: BP, title: "Sitting", mode: "online", status: "open",
  windowStart: new Date(Date.now() - 3600_000), windowEnd: new Date(Date.now() + 3600_000),
  slots: [], paper, totalMarks: 10, version: 1, ...over,
});
const attempt = (over = {}) => ({
  id: ATT, tenantId: TENANT, scheduleId: SCH, blueprintId: BP, candidateId: USER, status: "assigned",
  identityVerified: false, accommodation: {}, questionOrder: [Q2, Q1], version: 1, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  H.findSchedule.mockResolvedValue(schedule()); // default open schedule (overridden per-test)
  H.insertSchedule.mockResolvedValue(undefined);
  H.updateSchedule.mockResolvedValue(undefined);
  H.insertAttempt.mockResolvedValue(undefined);
  H.updateAttempt.mockResolvedValue(undefined);
  H.saveResponse.mockResolvedValue(undefined);
  H.updateResponseScore.mockResolvedValue(undefined);
  H.listResponses.mockResolvedValue([]);
  H.listAttemptsBySchedule.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

const createBody = (qs: Array<{ questionId: string; section: string }>) => ({
  blueprintId: BP, title: "Sitting", windowStart: new Date(Date.now() + 1000).toISOString(), windowEnd: new Date(Date.now() + 7200_000).toISOString(), questions: qs,
});

describe("assessment schedule + attempt routes", () => {
  it("assembles and schedules from an active blueprint (201)", async () => {
    H.findBlueprint.mockResolvedValue(activeBlueprint());
    H.findQuestion.mockImplementation((_t: string, id: string) => Promise.resolve(validatedQ(id)));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/assessments/schedules", headers: auth, payload: createBody([{ questionId: Q1, section: "apt" }, { questionId: Q2, section: "apt" }]) });
    expect(r.statusCode).toBe(201);
    expect(r.json().totalMarks).toBe(10);
    expect(H.insertSchedule).toHaveBeenCalledOnce();
    await app.close();
  });

  it("rejects a paper whose section count does not match the blueprint (422)", async () => {
    H.findBlueprint.mockResolvedValue(activeBlueprint());
    H.findQuestion.mockImplementation((_t: string, id: string) => Promise.resolve(validatedQ(id)));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/assessments/schedules", headers: auth, payload: createBody([{ questionId: Q1, section: "apt" }]) });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("SECTION_COUNT_MISMATCH");
    await app.close();
  });

  it("refuses to schedule from an inactive blueprint (409)", async () => {
    H.findBlueprint.mockResolvedValue(activeBlueprint({ status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/assessments/schedules", headers: auth, payload: createBody([{ questionId: Q1, section: "apt" }, { questionId: Q2, section: "apt" }]) });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("BLUEPRINT_NOT_ACTIVE");
    await app.close();
  });

  it("rejects an unvalidated question in the paper (422)", async () => {
    H.findBlueprint.mockResolvedValue(activeBlueprint());
    H.findQuestion.mockImplementation((_t: string, id: string) => Promise.resolve({ ...validatedQ(id), status: "draft" }));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/assessments/schedules", headers: auth, payload: createBody([{ questionId: Q1, section: "apt" }, { questionId: Q2, section: "apt" }]) });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("QUESTION_NOT_VALIDATED");
    await app.close();
  });

  it("assigns a candidate and randomises their question order (201)", async () => {
    H.findSchedule.mockResolvedValue(schedule());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/schedules/${SCH}/attempts`, headers: auth, payload: { candidateId: USER } });
    expect(r.statusCode).toBe(201);
    const order = H.insertAttempt.mock.calls[0][1].questionOrder as string[];
    expect([...order].sort()).toEqual([Q1, Q2].sort());
    await app.close();
  });

  it("blocks starting an attempt before identity verification (409)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ identityVerified: false }));
    H.findSchedule.mockResolvedValue(schedule());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/start`, headers: auth, payload: {} });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("IDENTITY_REQUIRED");
    await app.close();
  });

  it("starts an identity-verified attempt within the window and sets a deadline (200)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ identityVerified: true }));
    H.findSchedule.mockResolvedValue(schedule({ status: "open" }));
    H.findBlueprint.mockResolvedValue(activeBlueprint());
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/start`, headers: auth, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("in_progress");
    expect(r.json().deadlineAt).toBeTruthy();
    await app.close();
  });

  it("delivers the paper in candidate order WITHOUT answer keys", async () => {
    H.findAttempt.mockResolvedValue(attempt({ status: "in_progress", questionOrder: [Q2, Q1] }));
    H.findSchedule.mockResolvedValue(schedule());
    const app = await buildApp();
    const r = await app.inject({ method: "GET", url: `/v1/hrms/assessments/attempts/${ATT}/paper`, headers: auth });
    expect(r.statusCode).toBe(200);
    const qs = r.json().questions;
    expect(qs.map((q: { questionId: string }) => q.questionId)).toEqual([Q2, Q1]); // candidate order
    expect(qs.every((q: Record<string, unknown>) => !("answerKey" in q))).toBe(true); // keys stripped
    await app.close();
  });

  it("auto-saves responses while in progress (200) and rejects unknown questions (422)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ status: "in_progress", deadlineAt: new Date(Date.now() + 600_000) }));
    const app = await buildApp();
    const ok = await app.inject({ method: "PATCH", url: `/v1/hrms/assessments/attempts/${ATT}/responses`, headers: auth, payload: { responses: [{ questionId: Q1, response: { selected: ["b"] } }] } });
    expect(ok.statusCode).toBe(200);
    expect(H.saveResponse).toHaveBeenCalledOnce();
    const bad = await app.inject({ method: "PATCH", url: `/v1/hrms/assessments/attempts/${ATT}/responses`, headers: auth, payload: { responses: [{ questionId: "99999999-3333-4000-8000-000000000009", response: {} }] } });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe("UNKNOWN_QUESTION");
    await app.close();
  });

  it("stops in-progress answering when the sitting is cancelled (409)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ status: "in_progress", deadlineAt: new Date(Date.now() + 600_000) }));
    H.findSchedule.mockResolvedValue(schedule({ status: "cancelled" }));
    const app = await buildApp();
    const save = await app.inject({ method: "PATCH", url: `/v1/hrms/assessments/attempts/${ATT}/responses`, headers: auth, payload: { responses: [{ questionId: Q1, response: { selected: ["b"] } }] } });
    expect(save.statusCode).toBe(409);
    expect(save.json().code).toBe("SCHEDULE_CANCELLED");
    expect(H.saveResponse).not.toHaveBeenCalled();
    const sub = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/submit`, headers: auth, payload: {} });
    expect(sub.statusCode).toBe(409);
    expect(sub.json().code).toBe("SCHEDULE_CANCELLED");
    expect(H.updateAttempt).not.toHaveBeenCalled();
    await app.close();
  });

  it("rejects a paper containing a duplicate question (422)", async () => {
    H.findBlueprint.mockResolvedValue(activeBlueprint());
    H.findQuestion.mockImplementation((_t: string, id: string) => Promise.resolve(validatedQ(id)));
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: "/v1/hrms/assessments/schedules", headers: auth, payload: createBody([{ questionId: Q1, section: "apt" }, { questionId: Q1, section: "apt" }]) });
    expect(r.statusCode).toBe(422);
    expect(r.json().code).toBe("DUPLICATE_QUESTION");
    await app.close();
  });

  it("submits and auto-evaluates objective responses (200)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ status: "in_progress" }));
    H.findSchedule.mockResolvedValue(schedule());
    H.findBlueprint.mockResolvedValue(activeBlueprint());
    H.listResponses.mockResolvedValue([
      { questionId: Q1, response: { selected: ["b"] } }, // correct -> +5
      { questionId: Q2, response: { selected: ["b"] } }, // wrong (correct a) -> -1.25
    ]);
    const app = await buildApp();
    const r = await app.inject({ method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/submit`, headers: auth, payload: {} });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe("evaluated");
    expect(r.json().totalScore).toBe(3.75); // 5 - 1.25
    expect(r.json().result).toBe("not_qualified"); // 3.75/10 = 37.5% < 40% total cut-off
    expect(H.updateResponseScore).toHaveBeenCalledTimes(2); // both objective responses scored
    await app.close();
  });
});
