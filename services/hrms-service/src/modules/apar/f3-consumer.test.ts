/**
 * F3 APAR consumer — unit tests.
 *
 * Regression cover for the "generated F3 leftover consumer" bug class first
 * found in `leave_policy_admin_routes__0`: the generator that stubbed each route
 * down to a bare `publishF3Write(...)` dropped the preamble that fetched the
 * appraisal and computed the derived values, so stages 1–6 referenced undefined
 * names (`a`, `ctx`, `override`, `trueActorRole`, `grade`) and threw a
 * ReferenceError. Because the routes answer 200 as soon as the message is
 * queued, the entire APAR chain was a fake success — the caller was shown the
 * next stage (and, at acceptance, a grade and band) while the appraisal never
 * moved and no stage-history row was ever appended.
 *
 * The `every op completes without landing in the DLQ` test below is the direct
 * regression guard.
 *
 * Follows the MemoryQueue + mocked db.transaction pattern of
 * ../leave/f3-consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, insertValuesMock, R } = vi.hoisted(() => {
  const _insertValuesMock = vi.fn((..._a: any[]): any => undefined);
  const _R = {
    findAppraisal: vi.fn((..._a: any[]): any => undefined),
    updateAppraisal: vi.fn(async (..._a: any[]): Promise<any> => undefined),
    upsertScore: vi.fn(async (..._a: any[]): Promise<any> => undefined),
    appendHistory: vi.fn(async (..._a: any[]): Promise<any> => undefined),
    listScores: vi.fn(async (..._a: any[]): Promise<any> => []),
  } as Record<string, any>;
  // Nested-tx-deadlock fix (skill section 1): the consumer now reaches
  // findAppraisal/listScores exclusively through the Tx-suffixed siblings
  // (findAppraisalTx via the local mustAppraisal(tx) helper, listScoresTx
  // directly) so they read through the caller's already-open `tx` instead
  // of opening their own scopedRead transaction. Forward each Tx variant to
  // its non-Tx counterpart, dropping the leading `tx` arg, so existing
  // `R.findAppraisal.mockResolvedValue(...)` setup and the
  // `toHaveBeenCalledWith(APAR, TENANT)` assertion (which never expected a
  // tx argument) keep working unchanged.
  _R.findAppraisalTx = vi.fn((_tx: unknown, ...a: any[]) => _R.findAppraisal(...a));
  _R.listScoresTx = vi.fn(async (_tx: unknown, ...a: any[]) => _R.listScores(...a));
  return {
    insertValuesMock: _insertValuesMock,
    mockTx: {
      insert: vi.fn().mockReturnValue({ values: async (v: unknown) => { _insertValuesMock(v); } }),
    },
    R: _R,
  };
});

vi.mock("../../shared/db.js", () => {
  // TX-015: inlined, not imported from tests/fixtures/mock-sql-client.js --
  // this file lives under src/, whose tsconfig.json scopes rootDir to
  // ./src, and tsc --noEmit rejects any src/ file that reaches outside it.
  // Identical shape to createMockSqlClient(); see that file's doc comment.
  // The base must be a plain arrow function (not vi.fn(...)) for TS's
  // "properties on const functions" inference to allow the assignments
  // below -- see tests/fixtures/mock-sql-client.ts and
  // tests/id-cards-routes.test.ts for the same pattern.
  const sqlClientFn = (..._args: unknown[]) => Promise.resolve([]);
  sqlClientFn.end = vi.fn(async () => {});
  sqlClientFn.unsafe = vi.fn((..._args: unknown[]) => Promise.resolve([]));
  sqlClientFn.begin = vi.fn(async (fn: (tx: typeof sqlClientFn) => Promise<unknown>) => fn(sqlClientFn));

  return {
    db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(mockTx) },
    scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
    sqlClient: sqlClientFn,
  };
});
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => "stub" },
}));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (..._a: any[]): Promise<any> => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("./repo.js", () => ({
  listAppraisals: vi.fn(async () => []),
  listHistory: vi.fn(async () => []),
  findAppraisal: (...a: unknown[]) => R.findAppraisal(...a),
  findAppraisalTx: (...a: unknown[]) => R.findAppraisalTx(...a),
  updateAppraisal: (...a: unknown[]) => R.updateAppraisal(...a),
  upsertScore: (...a: unknown[]) => R.upsertScore(...a),
  appendHistory: (...a: unknown[]) => R.appendHistory(...a),
  listScores: (...a: unknown[]) => R.listScores(...a),
  listScoresTx: (...a: unknown[]) => R.listScoresTx(...a),
}));
// stageOverride (cases 1-5) now resolves the acting actor to their own
// hrms_employees.id before comparing against stageOwner()'s ownerId (see
// f3-consumer.ts and apar/routes.ts's assertStageOwner for the identity
// mismatch this closes: hrms_appraisals.employeeId/reportingOfficerId/etc.
// are hrms_employees.id values, never actor ids). Every fixture below
// already uses EMP/RO/RV/AA/HR (and the ad-hoc `admin` id) interchangeably
// as both "the actor" and "the hrms_employees.id stored on the appraisal",
// so an identity mapping here (actorId -> {id: actorId}) reproduces the
// exact same effective ownership relationships these tests were built
// around, including the "records a super_admin acting out of turn as an
// audited override" case below (a genuinely different actor id resolves to
// a genuinely different employee id, so it still correctly mismatches
// ownerId). Mocked wholesale (not routed through the hoisted `R`/mockTx
// machinery above) because the real resolveEmployeeForActor calls
// scopedRead -> tx.select(), and this file's mocked db.js only implements
// `insert` on its mockTx.
vi.mock("../employee/actor-link.js", () => ({
  resolveEmployeeForActor: async (_tenantId: string, actorId: string) => ({ id: actorId }),
}));

import { registerF3_apar_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const EMP = "30000000-cccc-4000-8000-000000000001";
const RO = "30000000-cccc-4000-8000-000000000002";
const RV = "30000000-cccc-4000-8000-000000000003";
const AA = "30000000-cccc-4000-8000-000000000004";
const HR = "30000000-cccc-4000-8000-000000000005";
const APAR = "40000000-dddd-4000-8000-000000000001";

const appraisal = (over: Record<string, unknown> = {}) => ({
  id: APAR, tenantId: TENANT, employeeId: EMP,
  reportingOfficerId: RO, reviewingOfficerId: RV, acceptingAuthorityId: AA,
  status: "self_pending", version: 7,
  overallGrade: null, overallBand: null,
  ...over,
});

function makeMsg(actorId: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.f3RouteWrite,
    tenantId: TENANT,
    actorId,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function run(actorId: string, payload: Record<string, unknown>): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_apar_Consumers(q);
  await q.start();
  await q.publish(COMMANDS.f3RouteWrite, makeMsg(actorId, { tenantId: TENANT, query: {}, ...payload }));
  await q.drain();
  return q;
}

const SCORES = [
  { attribute: "integrity", weight: "60", score: 9 },
  { attribute: "leadership", weight: "40", score: 8 },
];

beforeEach(() => {
  vi.clearAllMocks();
  R.findAppraisal.mockResolvedValue(appraisal());
  R.listScores.mockResolvedValue(SCORES);
});

const OPS: Array<{ op: string; actor: string; status: string; extra: Record<string, unknown> }> = [
  { op: "apar_routes__0", actor: HR, status: "self_pending", extra: { params: {}, body: { employeeId: EMP, appraisalPeriod: "2025-26", reportingOfficerId: RO, reviewingOfficerId: RV, acceptingAuthorityId: AA } } },
  { op: "apar_routes__1", actor: EMP, status: "self_pending", extra: { params: { id: APAR }, body: { selfAppraisal: "did well" } } },
  { op: "apar_routes__2", actor: RO, status: "reporting_officer", extra: { params: { id: APAR }, body: { penPicture: "solid", scores: [{ attribute: "integrity", weight: 60, score: 9 }, { attribute: "leadership", weight: 40, score: 8 }] } } },
  { op: "apar_routes__3", actor: RV, status: "reviewing_officer", extra: { params: { id: APAR }, body: { decision: "concur", remarks: "agreed" } } },
  { op: "apar_routes__4", actor: AA, status: "accepting_authority", extra: { params: { id: APAR }, body: { remarks: "accepted" } } },
  { op: "apar_routes__5", actor: EMP, status: "disclosed", extra: { params: { id: APAR }, body: { representation: "please review" } } },
  { op: "apar_routes__6", actor: HR, status: "representation", extra: { params: { id: APAR }, body: {} } },
];

describe("F3 apar consumer — every op runs (previously: ReferenceError on 6 of 7)", () => {
  for (const { op, actor, status, extra } of OPS) {
    it(`${op} completes without landing in the DLQ`, async () => {
      R.findAppraisal.mockResolvedValue(appraisal({ status }));
      const q = await run(actor, { op, id: randomUUID(), ...extra });
      expect(q.dlq).toEqual([]);
      await q.stop();
    });
  }
});

describe("apar_routes__0 (initiate APAR)", () => {
  it("inserts the appraisal keyed by the queued id and opens the stage history", async () => {
    const aparId = randomUUID();
    const q = await run(HR, {
      op: "apar_routes__0", id: aparId, params: {},
      body: { employeeId: EMP, appraisalPeriod: "2025-26", reportingOfficerId: RO, reviewingOfficerId: RV, acceptingAuthorityId: AA },
    });
    expect(q.dlq).toEqual([]);
    const v = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(v).toMatchObject({ id: aparId, tenantId: TENANT, employeeId: EMP, status: "self_pending", reportingOfficerId: RO });
    expect(R.appendHistory.mock.calls[0]![1]).toMatchObject({
      appraisalId: aparId, fromStage: null, toStage: "self_pending", actorRole: "initiator",
    });
    await q.stop();
  });
});

describe("apar_routes__1 (self-appraisal)", () => {
  it("advances the appraisal named by :id using its live version, and records the appraisee as actor", async () => {
    const msgId = randomUUID();
    const q = await run(EMP, { op: "apar_routes__1", id: msgId, params: { id: APAR }, body: { selfAppraisal: "did well" } });
    expect(q.dlq).toEqual([]);
    expect(R.findAppraisal).toHaveBeenCalledWith(APAR, TENANT);
    expect(R.updateAppraisal).toHaveBeenCalledOnce();
    const [, idArg, patchArg, versionArg] = R.updateAppraisal.mock.calls[0]!;
    // Regression: the update used to be keyed off the throwaway message id.
    expect(idArg).toBe(APAR);
    expect(idArg).not.toBe(msgId);
    expect(patchArg).toMatchObject({ selfAppraisal: "did well", status: "reporting_officer" });
    expect(versionArg).toBe(7);
    expect(R.appendHistory.mock.calls[0]![1]).toMatchObject({
      appraisalId: APAR, fromStage: "self_pending", toStage: "reporting_officer",
      actorId: EMP, actorRole: "appraisee", override: false,
    });
    await q.stop();
  });

  it("records a super_admin acting out of turn as an audited override, never as the appraisee", async () => {
    const admin = "30000000-cccc-4000-8000-00000000009f";
    const q = await run(admin, { op: "apar_routes__1", id: randomUUID(), params: { id: APAR }, body: { selfAppraisal: "entered by HR" } });
    expect(q.dlq).toEqual([]);
    expect(R.appendHistory.mock.calls[0]![1]).toMatchObject({
      actorId: admin, actorRole: "super_admin", override: true,
    });
    await q.stop();
  });
});

describe("apar_routes__2 (reporting officer scores)", () => {
  it("persists every attribute score and advances to the reviewing officer", async () => {
    R.findAppraisal.mockResolvedValue(appraisal({ status: "reporting_officer" }));
    const q = await run(RO, {
      op: "apar_routes__2", id: randomUUID(), params: { id: APAR },
      body: { penPicture: "solid", scores: [{ attribute: "integrity", weight: 60, score: 9 }, { attribute: "leadership", weight: 40, score: 8, remarks: "improving" }] },
    });
    expect(q.dlq).toEqual([]);
    expect(R.upsertScore).toHaveBeenCalledTimes(2);
    expect(R.upsertScore.mock.calls[0]![1]).toMatchObject({ appraisalId: APAR, attribute: "integrity", weight: "60", score: 9, scoredBy: RO });
    expect(R.upsertScore.mock.calls[1]![1]).toMatchObject({ attribute: "leadership", weight: "40", score: 8, remarks: "improving" });
    expect(R.updateAppraisal.mock.calls[0]![2]).toMatchObject({ reportingPenPicture: "solid", status: "reviewing_officer" });
    expect(R.appendHistory.mock.calls[0]![1]).toMatchObject({ actorRole: "reporting_officer", override: false });
    await q.stop();
  });

  it("applies the route schema's weight default when a caller omits it", async () => {
    R.findAppraisal.mockResolvedValue(appraisal({ status: "reporting_officer" }));
    const q = await run(RO, {
      op: "apar_routes__2", id: randomUUID(), params: { id: APAR },
      body: { penPicture: "solid", scores: [{ attribute: "integrity", score: 9 }] },
    });
    expect(q.dlq).toEqual([]);
    expect(R.upsertScore.mock.calls[0]![1]).toMatchObject({ weight: "1" });
    await q.stop();
  });
});

describe("apar_routes__3 (reviewing officer variation)", () => {
  it("rewrites only the varied attributes, preserving their weights", async () => {
    R.findAppraisal.mockResolvedValue(appraisal({ status: "reviewing_officer" }));
    const q = await run(RV, {
      op: "apar_routes__3", id: randomUUID(), params: { id: APAR },
      body: { decision: "vary", remarks: "over-marked", variations: [{ attribute: "integrity", score: 7 }, { attribute: "unknown", score: 3 }] },
    });
    expect(q.dlq).toEqual([]);
    // "unknown" is not an existing attribute and is skipped.
    expect(R.upsertScore).toHaveBeenCalledOnce();
    expect(R.upsertScore.mock.calls[0]![1]).toMatchObject({
      appraisalId: APAR, attribute: "integrity", weight: "60", score: 7, scoredBy: RV,
      remarks: "varied by reviewing officer (was 9)",
    });
    expect(R.updateAppraisal.mock.calls[0]![2]).toMatchObject({ reviewingRemarks: "over-marked", status: "accepting_authority" });
    await q.stop();
  });
});

describe("apar_routes__4 (accepting authority finalises the grade)", () => {
  it("server-computes the weighted grade and band from the persisted scores", async () => {
    R.findAppraisal.mockResolvedValue(appraisal({ status: "accepting_authority" }));
    const q = await run(AA, { op: "apar_routes__4", id: randomUUID(), params: { id: APAR }, body: { remarks: "accepted" } });
    expect(q.dlq).toEqual([]);
    // (9*60 + 8*40) / 100 = 8.6 -> "Very Good"
    expect(R.updateAppraisal.mock.calls[0]![2]).toMatchObject({
      acceptingRemarks: "accepted", overallGrade: "8.6", overallBand: "Very Good",
      status: "disclosed",
    });
    expect(R.appendHistory.mock.calls[0]![1]).toMatchObject({
      toStage: "disclosed", actorRole: "accepting_authority", override: false,
      payload: { computed: { overallGrade: 8.6, band: "Very Good", totalWeight: 100, attributeCount: 2 } },
    });
    await q.stop();
  });

  it("fails loudly rather than writing an ungraded acceptance when no scores exist", async () => {
    R.findAppraisal.mockResolvedValue(appraisal({ status: "accepting_authority" }));
    R.listScores.mockResolvedValue([]);
    const q = await run(AA, { op: "apar_routes__4", id: randomUUID(), params: { id: APAR }, body: { remarks: "accepted" } });
    expect(R.updateAppraisal).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toContain("no attribute scores");
    await q.stop();
  });
});

describe("apar_routes__6 (finalise)", () => {
  it("records the true previous stage it was finalised from", async () => {
    R.findAppraisal.mockResolvedValue(appraisal({ status: "representation" }));
    const q = await run(HR, { op: "apar_routes__6", id: randomUUID(), params: { id: APAR }, body: {} });
    expect(q.dlq).toEqual([]);
    expect(R.updateAppraisal.mock.calls[0]![2]).toMatchObject({ status: "finalised" });
    expect(R.appendHistory.mock.calls[0]![1]).toMatchObject({
      fromStage: "representation", toStage: "finalised", actorRole: "hr",
    });
    await q.stop();
  });

  it("fails loudly rather than writing when the appraisal no longer exists", async () => {
    R.findAppraisal.mockResolvedValue(null);
    const q = await run(HR, { op: "apar_routes__6", id: randomUUID(), params: { id: APAR }, body: {} });
    expect(R.updateAppraisal).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    await q.stop();
  });
});

describe("F3 apar consumer — op routing", () => {
  it("ignores ops that belong to another module's consumer", async () => {
    const q = await run(HR, { op: "some_other_module_routes__0", id: randomUUID(), params: {}, body: {} });
    expect(R.updateAppraisal).not.toHaveBeenCalled();
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(q.dlq).toEqual([]);
    await q.stop();
  });
});

/**
 * GAP-HR-AUDIT-LOG-08: the central audit trail (what the HR audit log page
 * reads) used to hear nothing about APAR. f3-consumer.ts imported `enqueue` and
 * never called it, and the audit handlers in ./consumer.ts have no production
 * publisher. Every one of the seven f3 ops now emits exactly one
 * `audit.event.record`, in the transaction that made the write.
 */
describe("GAP-HR-AUDIT-LOG-08: every APAR mutation emits one audit.event.record, in its own transaction", () => {
  // Free text / confidential content that must never reach the audit payload.
  const FREE_TEXT = ["TEXT-SELF-APPRAISAL", "TEXT-PEN-PICTURE", "TEXT-REVIEW-REMARKS", "TEXT-ACCEPT-REMARKS", "TEXT-REPRESENTATION", "TEXT-SCORE-REMARK"];

  const aparId = randomUUID();
  const CASES: Array<{
    name: string; op: string; actor: string; status: string; resourceId: string;
    extra: Record<string, unknown>; expected: Record<string, unknown>;
  }> = [
    {
      name: "create", op: "apar_routes__0", actor: HR, status: "self_pending", resourceId: aparId,
      extra: { id: aparId, params: {}, body: { employeeId: EMP, appraisalPeriod: "2025-26", reportingOfficerId: RO, reviewingOfficerId: RV, acceptingAuthorityId: AA } },
      expected: { action: "create", employeeId: EMP, appraisalPeriod: "2025-26", fromStage: null, toStage: "self_pending" },
    },
    {
      name: "self-appraisal", op: "apar_routes__1", actor: EMP, status: "self_pending", resourceId: APAR,
      extra: { params: { id: APAR }, body: { selfAppraisal: "TEXT-SELF-APPRAISAL" } },
      expected: { action: "self_appraisal", employeeId: EMP, fromStage: "self_pending", toStage: "reporting_officer", actorRole: "appraisee", override: false },
    },
    {
      name: "reporting officer scores", op: "apar_routes__2", actor: RO, status: "reporting_officer", resourceId: APAR,
      extra: { params: { id: APAR }, body: { penPicture: "TEXT-PEN-PICTURE", scores: [{ attribute: "integrity", weight: 60, score: 9, remarks: "TEXT-SCORE-REMARK" }, { attribute: "leadership", weight: 40, score: 8 }] } },
      expected: { action: "reporting", employeeId: EMP, fromStage: "reporting_officer", toStage: "reviewing_officer", actorRole: "reporting_officer", override: false, scoreCount: 2 },
    },
    {
      name: "reviewing officer (concur)", op: "apar_routes__3", actor: RV, status: "reviewing_officer", resourceId: APAR,
      extra: { params: { id: APAR }, body: { decision: "concur", remarks: "TEXT-REVIEW-REMARKS" } },
      expected: { action: "reviewing", fromStage: "reviewing_officer", toStage: "accepting_authority", actorRole: "reviewing_officer", override: false, decision: "concur", variationCount: 0 },
    },
    {
      name: "reviewing officer (vary)", op: "apar_routes__3", actor: RV, status: "reviewing_officer", resourceId: APAR,
      extra: { params: { id: APAR }, body: { decision: "vary", remarks: "TEXT-REVIEW-REMARKS", variations: [{ attribute: "integrity", score: 7 }] } },
      expected: { action: "reviewing", decision: "vary", variationCount: 1 },
    },
    {
      name: "accepting authority", op: "apar_routes__4", actor: AA, status: "accepting_authority", resourceId: APAR,
      extra: { params: { id: APAR }, body: { remarks: "TEXT-ACCEPT-REMARKS" } },
      expected: { action: "accept", employeeId: EMP, fromStage: "accepting_authority", toStage: "disclosed", actorRole: "accepting_authority", override: false },
    },
    {
      name: "representation", op: "apar_routes__5", actor: EMP, status: "disclosed", resourceId: APAR,
      extra: { params: { id: APAR }, body: { representation: "TEXT-REPRESENTATION" } },
      expected: { action: "representation", employeeId: EMP, fromStage: "disclosed", toStage: "representation", actorRole: "appraisee", override: false },
    },
    {
      name: "finalise", op: "apar_routes__6", actor: HR, status: "representation", resourceId: APAR,
      extra: { params: { id: APAR }, body: {} },
      expected: { action: "finalise", employeeId: EMP, fromStage: "representation", toStage: "finalised", actorRole: "hr" },
    },
  ];

  for (const c of CASES) {
    it(`${c.name}: exactly one event, on the write's own tx, with tenant + actor and ids only`, async () => {
      R.findAppraisal.mockResolvedValue(appraisal({ status: c.status }));
      const q = await run(c.actor, { op: c.op, ...(c.extra.id ? {} : { id: randomUUID() }), ...c.extra });
      expect(q.dlq).toEqual([]);

      expect(vi.mocked(enqueue)).toHaveBeenCalledTimes(1);
      const [txArg, evt] = vi.mocked(enqueue).mock.calls[0]! as [unknown, Record<string, any>];
      // Same transaction handle the write ran on (markProcessed / appendHistory got it too).
      expect(txArg).toBe(mockTx);
      expect(R.appendHistory.mock.calls[0]![0]).toBe(mockTx);
      expect(evt).toMatchObject({
        topic: "audit.event.record", eventType: "audit.event.record",
        tenantId: TENANT, actorId: c.actor,
      });
      expect(evt.correlationId).toMatch(/^corr-/);
      expect(evt.payload).toMatchObject({
        service: "hrms", resourceType: "apar", resourceId: c.resourceId, outcome: "success", ...c.expected,
      });
      // After the write and its history row, never before: a failed write leaves no audit event.
      expect(vi.mocked(enqueue).mock.invocationCallOrder[0]!).toBeGreaterThan(R.appendHistory.mock.invocationCallOrder[0]!);

      const wire = JSON.stringify(evt);
      for (const t of FREE_TEXT) expect(wire, `${t} leaked into the audit event`).not.toContain(t);
      expect(evt.payload).not.toHaveProperty("overallGrade");
      expect(evt.payload).not.toHaveProperty("overallBand");
      await q.stop();
    });
  }

  it("records a super_admin acting out of turn as an audited override on the audit event too", async () => {
    const admin = "30000000-cccc-4000-8000-00000000009f";
    const q = await run(admin, { op: "apar_routes__1", id: randomUUID(), params: { id: APAR }, body: { selfAppraisal: "entered by HR" } });
    expect(q.dlq).toEqual([]);
    expect(vi.mocked(enqueue).mock.calls[0]![1]).toMatchObject({
      actorId: admin, payload: { action: "self_appraisal", actorRole: "super_admin", override: true },
    });
    await q.stop();
  });

  it("a redelivered command (markProcessed false) writes nothing and emits nothing", async () => {
    vi.mocked(markProcessed).mockResolvedValueOnce(false);
    const q = await run(EMP, { op: "apar_routes__1", id: randomUUID(), params: { id: APAR }, body: { selfAppraisal: "x" } });
    expect(q.dlq).toEqual([]);
    expect(R.updateAppraisal).not.toHaveBeenCalled();
    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
    await q.stop();
  });

  it("a rejected write (version conflict) emits no audit event", async () => {
    R.updateAppraisal.mockRejectedValueOnce(new Error("VERSION_CONFLICT"));
    const q = await run(EMP, { op: "apar_routes__1", id: randomUUID(), params: { id: APAR }, body: { selfAppraisal: "x" } });
    expect(q.dlq).toHaveLength(1);
    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
    await q.stop();
  });

  it("a rejected op (appraisal not found / no scores) emits no audit event", async () => {
    R.findAppraisal.mockResolvedValue(null);
    const q1 = await run(HR, { op: "apar_routes__6", id: randomUUID(), params: { id: APAR }, body: {} });
    expect(q1.dlq).toHaveLength(1);
    R.findAppraisal.mockResolvedValue(appraisal({ status: "accepting_authority" }));
    R.listScores.mockResolvedValue([]);
    const q2 = await run(AA, { op: "apar_routes__4", id: randomUUID(), params: { id: APAR }, body: { remarks: "r" } });
    expect(q2.dlq).toHaveLength(1);
    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
    await q1.stop();
    await q2.stop();
  });

  it("ops that belong to another module emit nothing from this consumer", async () => {
    const q = await run(HR, { op: "some_other_module_routes__0", id: randomUUID(), params: {}, body: {} });
    expect(vi.mocked(enqueue)).not.toHaveBeenCalled();
    await q.stop();
  });
});
