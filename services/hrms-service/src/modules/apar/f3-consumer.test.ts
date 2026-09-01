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
  return {
    insertValuesMock: _insertValuesMock,
    mockTx: {
      insert: vi.fn().mockReturnValue({ values: async (v: unknown) => { _insertValuesMock(v); } }),
    },
    R: {
      findAppraisal: vi.fn((..._a: any[]): any => undefined),
      updateAppraisal: vi.fn(async (..._a: any[]): Promise<any> => undefined),
      upsertScore: vi.fn(async (..._a: any[]): Promise<any> => undefined),
      appendHistory: vi.fn(async (..._a: any[]): Promise<any> => undefined),
      listScores: vi.fn(async (..._a: any[]): Promise<any> => []),
    },
  };
});

vi.mock("../../shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(mockTx) },
  scopedRead: async (fn: (tx: unknown) => Promise<unknown>) => fn(mockTx),
  sqlClient: { end: async () => {} },
}));
vi.mock("../../shared/infra.js", () => ({
  cache: { invalidate: async () => {}, makeKey: (...a: string[]) => a.join(":"), getOrLoad: async (_k: string, fn: () => Promise<unknown>) => fn() },
  queue: { publish: async () => "stub" },
}));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (..._a: any[]): Promise<any> => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("./repo.js", () => ({
  findAppraisal: (...a: unknown[]) => R.findAppraisal(...a),
  updateAppraisal: (...a: unknown[]) => R.updateAppraisal(...a),
  upsertScore: (...a: unknown[]) => R.upsertScore(...a),
  appendHistory: (...a: unknown[]) => R.appendHistory(...a),
  listScores: (...a: unknown[]) => R.listScores(...a),
}));

import { registerF3_apar_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

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
