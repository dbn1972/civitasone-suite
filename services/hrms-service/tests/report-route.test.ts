/**
 * Assessment disposition + reporting routes — malpractice void, reschedule (void +
 * fresh attempt), schedule report, item analysis, and the senior-role gate.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { signToken } from "@civitasone/auth";

const SECRET = process.env.JWT_SECRET ?? "test_secret_for_civitasone_32chr";
const TENANT = "aaaaaaaa-5555-4000-8000-000000000a55";
const ADMIN = "aaaaaaaa-7777-4000-8000-000000000a55";
const SCH = "dddddddd-5555-4000-8000-00000000d055";
const ATT = "eeeeeeee-5555-4000-8000-00000000e055";
const Q1 = "11111111-5555-4000-8000-000000000001";
const Q2 = "11111111-5555-4000-8000-000000000002";

const H = vi.hoisted(() => ({
  findAttempt: vi.fn(), updateAttempt: vi.fn(), insertAttempt: vi.fn(), findSchedule: vi.fn(), listAttemptsBySchedule: vi.fn(),
  insertResultEvent: vi.fn(), listResponsesForAttempts: vi.fn(),
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
vi.mock("../src/modules/recruitment/attempt-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  findAttempt: (...a: unknown[]) => H.findAttempt(...a),
  updateAttempt: (...a: unknown[]) => H.updateAttempt(...a),
  insertAttempt: (...a: unknown[]) => H.insertAttempt(...a),
  findSchedule: (...a: unknown[]) => H.findSchedule(...a),
  listAttemptsBySchedule: (...a: unknown[]) => H.listAttemptsBySchedule(...a),
}));
vi.mock("../src/modules/recruitment/result-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  insertResultEvent: (...a: unknown[]) => H.insertResultEvent(...a),
}));
vi.mock("../src/modules/recruitment/report-repo.js", async (io) => ({
  ...(await io<Record<string, unknown>>()),
  listResponsesForAttempts: (...a: unknown[]) => H.listResponsesForAttempts(...a),
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

const admin = { authorization: `Bearer ${signToken({ sub: ADMIN, tid: TENANT, roles: ["hr_admin"], sid: "s" }, SECRET)}` };
const officer = { authorization: `Bearer ${signToken({ sub: ADMIN, tid: TENANT, roles: ["hr_officer"], sid: "s" }, SECRET)}` };
const paper = [
  { questionId: Q1, section: "s", marks: 10, qtype: "mcq", answerKey: { correct: ["b"] } },
  { questionId: Q2, section: "s", marks: 20, qtype: "descriptive" },
];
const schedule = (over = {}) => ({ id: SCH, tenantId: TENANT, blueprintId: "bp", title: "Sitting", status: "open", totalMarks: 30, paper, ...over });
const attempt = (over = {}) => ({ id: ATT, tenantId: TENANT, scheduleId: SCH, blueprintId: "bp", candidateId: "cand", accommodation: {}, status: "evaluated", result: "qualified", frozen: false, version: 1, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  H.findSchedule.mockResolvedValue(schedule());
  H.updateAttempt.mockResolvedValue(undefined);
  H.insertAttempt.mockResolvedValue(undefined);
  H.insertResultEvent.mockResolvedValue(undefined);
  H.listAttemptsBySchedule.mockResolvedValue([]);
  H.listResponsesForAttempts.mockResolvedValue([]);
});
afterAll(async () => { await sqlClient.end(); });

describe("assessment disposition + report routes", () => {
  it("voids an attempt for malpractice (senior role) and blocks hr_officer (403)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    const app = await buildApp();
    const denied = await injectF3(app, { method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/malpractice`, headers: officer, payload: { reason: "impersonation" } });
    expect(denied.statusCode).toBe(403);
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/malpractice`, headers: admin, payload: { reason: "impersonation" } });
    expect(r.statusCode).toBe(200);
    expect(r.json().disposition).toBe("malpractice");
    const patch = H.updateAttempt.mock.calls[0][3] as { status: string; disposition: string };
    expect(patch.status).toBe("void");
    expect(patch.disposition).toBe("malpractice");
    await app.close();
  });

  it("refuses to malpractice an already-void attempt (409)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ status: "void" }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/malpractice`, headers: admin, payload: { reason: "duplicate flag" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("ALREADY_VOID");
    await app.close();
  });

  it("malpractice on a published+frozen result revokes it (clears frozen/published)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ frozen: true, published: true }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/malpractice`, headers: admin, payload: { reason: "post-result impersonation finding" } });
    expect(r.statusCode).toBe(200);
    const patch = H.updateAttempt.mock.calls[0][3] as { frozen: boolean; published: boolean; status: string };
    expect(patch.frozen).toBe(false);
    expect(patch.published).toBe(false);
    expect(patch.status).toBe("void");
    await app.close();
  });

  it("reschedules: voids the original and creates a fresh randomised attempt (201)", async () => {
    H.findAttempt.mockResolvedValue(attempt());
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/reschedule`, headers: admin, payload: { type: "technical_disruption", reason: "power outage" } });
    expect(r.statusCode).toBe(201);
    expect(r.json().newAttemptId).toBeTruthy();
    // original voided + superseded
    const patch = H.updateAttempt.mock.calls[0][3] as { status: string; supersededBy: string };
    expect(patch.status).toBe("void");
    expect(patch.supersededBy).toBe(r.json().newAttemptId);
    // new attempt inserted with a full-paper randomised order
    const ins = H.insertAttempt.mock.calls[0][1] as { questionOrder: string[]; status: string };
    expect([...ins.questionOrder].sort()).toEqual([Q1, Q2].sort());
    expect(ins.status).toBe("assigned");
    await app.close();
  });

  it("refuses to reschedule a frozen result (409)", async () => {
    H.findAttempt.mockResolvedValue(attempt({ frozen: true }));
    const app = await buildApp();
    const r = await injectF3(app, { method: "POST", url: `/v1/hrms/assessments/attempts/${ATT}/reschedule`, headers: admin, payload: { type: "retest", reason: "network failed mid-exam" } });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe("FROZEN");
    await app.close();
  });

  it("restricts a small-cohort report to senior roles (hr_officer 403, hr_admin 200)", async () => {
    // 2 non-void respondents (< MIN_REPORT_COHORT) — individually identifying.
    H.listAttemptsBySchedule.mockResolvedValue([
      attempt({ status: "evaluated", result: "qualified", totalScore: "27.00", maxScore: "30.00" }),
      attempt({ id: "x", status: "evaluated", result: "not_qualified", totalScore: "5.00", maxScore: "30.00" }),
      attempt({ id: "y", status: "void", disposition: "malpractice" }),
    ]);
    const app = await buildApp();
    const denied = await injectF3(app, { method: "GET", url: `/v1/hrms/assessments/schedules/${SCH}/report`, headers: officer });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe("SMALL_COHORT");
    const ok = await injectF3(app, { method: "GET", url: `/v1/hrms/assessments/schedules/${SCH}/report`, headers: admin });
    expect(ok.statusCode).toBe(200);
    await app.close();
  });

  it("produces a schedule report for a real cohort (hr_officer allowed)", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => attempt({ id: `r${i}`, status: "evaluated", result: i < 4 ? "qualified" : "not_qualified", totalScore: i < 4 ? "27.00" : "6.00", maxScore: "30.00" }));
    rows.push(attempt({ id: "assigned1", status: "assigned", result: "pending" }));
    rows.push(attempt({ id: "voided1", status: "void", result: "not_qualified", disposition: "malpractice" }));
    H.listAttemptsBySchedule.mockResolvedValue(rows);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/assessments/schedules/${SCH}/report`, headers: officer });
    expect(r.statusCode).toBe(200); // 7 non-void >= MIN_REPORT_COHORT -> aggregate, hr_officer allowed
    const b = r.json();
    expect(b.attendance).toMatchObject({ evaluated: 6, assigned: 1, voided: 1 });
    expect(b.cutoff).toMatchObject({ qualified: 4, notQualified: 2, pending: 1 });
    expect(b.scoreDistribution).toHaveLength(5);
    await app.close();
  });

  it("produces item analysis with difficulty index (excludes void attempts)", async () => {
    H.listAttemptsBySchedule.mockResolvedValue([attempt({ status: "evaluated" }), attempt({ id: "v", status: "void" })]);
    H.listResponsesForAttempts.mockResolvedValue([
      { questionId: Q1, isCorrect: true, autoScore: "10" },
      { questionId: Q1, isCorrect: false, autoScore: "0" },
      { questionId: Q2, isCorrect: null, autoScore: null },
    ]);
    const app = await buildApp();
    const r = await injectF3(app, { method: "GET", url: `/v1/hrms/assessments/schedules/${SCH}/item-analysis`, headers: admin });
    expect(r.statusCode).toBe(200);
    const items = r.json().items;
    expect(items.find((i: { questionId: string }) => i.questionId === Q1)).toMatchObject({ attempted: 2, correct: 1, difficultyIndex: 0.5 });
    expect(items.find((i: { questionId: string }) => i.questionId === Q2).difficultyIndex).toBeNull();
    // listResponsesForAttempts must be called WITHOUT the void attempt id
    expect(H.listResponsesForAttempts.mock.calls[0][1]).toEqual([ATT]);
    await app.close();
  });
});
