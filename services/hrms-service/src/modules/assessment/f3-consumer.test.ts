/**
 * F3 assessment consumer — unit tests.
 *
 * Same bug class as the leave fix documented in ../leave/f3-consumer.test.ts.
 * Three cases referenced locals the code-gen never defined and so threw a
 * ReferenceError on every invocation, each after the route had already
 * answered 2xx:
 *   __1 (add question)     — `qid`
 *   __7 (start attempt)    — `attemptId`, `priorCount`
 *   __8 (submit attempt)   — `attempt`, `a`, `bank`, `graded`, `passed`
 * __8 is the worst of the three: the route returns a score and a certificate to
 * the candidate while nothing is graded, no answers are stored, and no
 * certificate row is ever written.
 *
 * The real ./domain.js is used (gradeAttempt/decidePass/issueCertificate are
 * pure), so the score these tests assert is the score the engine actually
 * produces. Driven directly over a MemoryQueue because the F3 consumers are
 * registered only in worker.ts, never in app.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, enqueueMock, R } = vi.hoisted(() => {
  const _mockTx = { insert: vi.fn(), update: vi.fn(), select: vi.fn() };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueueMock = vi.fn(async (..._a: any[]) => undefined);
  const _R = {
    insertQuestion: vi.fn(async (..._a: any[]) => undefined),
    insertAttempt: vi.fn(async (..._a: any[]) => undefined),
    countAttempts: vi.fn(async (..._a: any[]) => 0),
    getAttempt: vi.fn(async (..._a: any[]) => undefined as any),
    getAssessment: vi.fn(async (..._a: any[]) => undefined as any),
    getBank: vi.fn(async (..._a: any[]) => undefined as any),
    listQuestions: vi.fn(async (..._a: any[]) => [] as any[]),
    gradeAttemptRow: vi.fn(async (..._a: any[]) => null as any),
    insertAnswers: vi.fn(async (..._a: any[]) => undefined),
    insertCertificate: vi.fn(async (..._a: any[]) => null as any),
    updatePassingScore: vi.fn(async (..._a: any[]) => null),
    submitForApproval: vi.fn(async (..._a: any[]) => null),
    publishAssessment: vi.fn(async (..._a: any[]) => null),
    retireAssessment: vi.fn(async (..._a: any[]) => null),
    insertBank: vi.fn(async (..._a: any[]) => undefined),
    insertAssessment: vi.fn(async (..._a: any[]) => undefined),
  };
  return { mockTx: _mockTx, dbTransactionFn: _dbTransactionFn, enqueueMock: _enqueueMock, R: _R };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: (...a: unknown[]) => enqueueMock(...(a as [])),
  markProcessed: vi.fn(async (..._a: any[]) => true),
}));
vi.mock("./repo.js", () => R);

import { registerF3_assessment_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const BANK = "30000000-cccc-4000-8000-000000000001";
const ASSESSMENT = "40000000-dddd-4000-8000-000000000001";
const ATTEMPT = "50000000-eeee-4000-8000-000000000001";
const EMPLOYEE = "60000000-ffff-4000-8000-000000000001";
const Q1 = "70000000-1111-4000-8000-000000000001";
const Q2 = "70000000-1111-4000-8000-000000000002";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_assessment_Consumers(q);
  await q.start();
  return q;
}

/** Two 5-mark single-choice questions, correct answer "a" on both. */
const questionRows = () => [
  { id: Q1, qtype: "single", correct: ["a"], marks: "5" },
  { id: Q2, qtype: "single", correct: ["a"], marks: "5" },
];

beforeEach(() => {
  vi.clearAllMocks();
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
  R.countAttempts.mockResolvedValue(0);
  R.getAttempt.mockResolvedValue({ id: ATTEMPT, tenantId: TENANT, assessmentId: ASSESSMENT, employeeId: EMPLOYEE, status: "in_progress", attemptNo: 1 });
  R.getAssessment.mockResolvedValue({ id: ASSESSMENT, tenantId: TENANT, bankId: BANK, passingScore: "10", validityMonths: 12, maxAttempts: 3 });
  R.getBank.mockResolvedValue({ id: BANK, tenantId: TENANT, competencyRef: "COMP-FIRE" });
  R.listQuestions.mockResolvedValue(questionRows());
  R.gradeAttemptRow.mockResolvedValue({ id: ATTEMPT, tenantId: TENANT, assessmentId: ASSESSMENT, employeeId: EMPLOYEE, status: "graded" });
  R.insertCertificate.mockResolvedValue({ certificateNo: "CERT-2026-ABCDEF01", verifyToken: "tok123", validUntil: null });
});

describe("assessment_routes__1 (add a question to a bank)", () => {
  it("inserts the question instead of throwing ReferenceError: qid is not defined", async () => {
    const q = await buildQueue();
    const qid = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "assessment_routes__1", id: qid, tenantId: TENANT,
      body: { qtype: "single", stem: "2+2?", options: [{ id: "a", text: "4" }], correct: ["a"], marks: 5 },
      params: { id: BANK }, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(R.insertQuestion).toHaveBeenCalledOnce();
    const row = R.insertQuestion.mock.calls[0]![1] as Record<string, any>;
    expect(row.id).toBe(qid);
    // Regression guard for the second defect: the bank must come from the URL
    // path param, NOT from the publish-time uuid in `p.id`.
    expect(row.bankId).toBe(BANK);
    expect(row.marks).toBe("5");
    await q.stop();
  });
});

describe("assessment lifecycle transitions address the plan by path id", () => {
  it.each([
    ["assessment_routes__3", () => R.updatePassingScore, { passingScore: 12 }],
    ["assessment_routes__4", () => R.submitForApproval, {}],
    ["assessment_routes__5", () => R.publishAssessment, {}],
    ["assessment_routes__6", () => R.retireAssessment, {}],
  ])("%s targets the :id from the URL, not the publish-time uuid", async (op, getMock, body) => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op, id: randomUUID(), tenantId: TENANT, body, params: { id: ASSESSMENT }, query: {},
    }));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(getMock()).toHaveBeenCalledOnce();
    expect(getMock().mock.calls[0]![2]).toBe(ASSESSMENT);
    await q.stop();
  });
});

describe("assessment_routes__7 (start an attempt)", () => {
  it("numbers the attempt from the prior count instead of throwing ReferenceError: priorCount is not defined", async () => {
    R.countAttempts.mockResolvedValue(2);
    const q = await buildQueue();
    const attemptId = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "assessment_routes__7", id: attemptId, tenantId: TENANT,
      body: { employeeId: EMPLOYEE }, params: { id: ASSESSMENT }, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(R.countAttempts).toHaveBeenCalledWith(TENANT, ASSESSMENT, EMPLOYEE);
    const row = R.insertAttempt.mock.calls[0]![1] as Record<string, any>;
    expect(row.id).toBe(attemptId);
    expect(row.assessmentId).toBe(ASSESSMENT);
    expect(row.employeeId).toBe(EMPLOYEE);
    expect(row.attemptNo).toBe(3);
    expect(row.status).toBe("in_progress");
    await q.stop();
  });
});

describe("assessment_routes__8 (submit and grade an attempt)", () => {
  const submit = (answers: unknown[]) => makeMsg({
    op: "assessment_routes__8", id: randomUUID(), tenantId: TENANT,
    body: { answers }, params: { id: ATTEMPT }, query: {},
  });

  it("grades, stores answers and issues a certificate on a pass", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, submit([
      { questionId: Q1, response: ["a"] }, { questionId: Q2, response: ["a"] },
    ]));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    // both correct → 10 marks, passingScore 10 → pass
    expect(R.gradeAttemptRow).toHaveBeenCalledOnce();
    expect(R.gradeAttemptRow.mock.calls[0]![2]).toBe(ATTEMPT);
    expect(R.gradeAttemptRow.mock.calls[0]![3]).toEqual({ score: "10", passed: true });

    const answers = R.insertAnswers.mock.calls[0]![1] as Array<Record<string, any>>;
    expect(answers).toHaveLength(2);
    expect(answers[0]!.attemptId).toBe(ATTEMPT);
    expect(answers.map((a) => a.awardedMarks)).toEqual(["5", "5"]);

    const cert = R.insertCertificate.mock.calls[0]![1] as Record<string, any>;
    expect(cert.assessmentId).toBe(ASSESSMENT);
    expect(cert.attemptId).toBe(ATTEMPT);
    expect(cert.employeeId).toBe(EMPLOYEE);
    expect(cert.certificateNo).toMatch(/^CERT-\d{4}-[0-9A-F]{8}$/);

    // certificate.issued event carries the bank's competency ref
    expect(enqueueMock).toHaveBeenCalledOnce();
    const evt = enqueueMock.mock.calls[0]![1] as Record<string, any>;
    expect(evt.payload.employee_id).toBe(EMPLOYEE);
    expect(evt.payload.competency_ref).toBe("COMP-FIRE");
    await q.stop();
  });

  it("does not issue a certificate on a fail", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, submit([
      { questionId: Q1, response: ["a"] }, { questionId: Q2, response: ["b"] },
    ]));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(R.gradeAttemptRow.mock.calls[0]![3]).toEqual({ score: "5", passed: false });
    const answers = R.insertAnswers.mock.calls[0]![1] as Array<Record<string, any>>;
    expect(answers.map((a) => a.awardedMarks)).toEqual(["5", "0"]);
    expect(R.insertCertificate).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("stays idempotent when a certificate already exists for the attempt", async () => {
    R.insertCertificate.mockResolvedValue(null); // UNIQUE(attempt_id) conflict
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, submit([
      { questionId: Q1, response: ["a"] }, { questionId: Q2, response: ["a"] },
    ]));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(R.insertCertificate).toHaveBeenCalledOnce();
    expect(enqueueMock).not.toHaveBeenCalled(); // must NOT re-emit the event
    await q.stop();
  });

  it("drops the write when the attempt was already graded (lost the race)", async () => {
    R.gradeAttemptRow.mockResolvedValue(null);
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, submit([{ questionId: Q1, response: ["a"] }]));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(R.insertAnswers).not.toHaveBeenCalled();
    expect(R.insertCertificate).not.toHaveBeenCalled();
    await q.stop();
  });

  it("drops the write when the attempt no longer exists", async () => {
    R.getAttempt.mockResolvedValue(undefined);
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, submit([{ questionId: Q1, response: ["a"] }]));
    await q.drain();
    expect(q.dlq).toHaveLength(0);
    expect(R.gradeAttemptRow).not.toHaveBeenCalled();
    await q.stop();
  });
});
