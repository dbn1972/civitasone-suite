/**
 * F3 disciplinary consumer — unit tests.
 *
 * Regression cover for the "generated F3 leftover consumer" bug class first
 * found in `leave_policy_admin_routes__0`: the generator that stubbed each route
 * down to a bare `publishF3Write(...)` dropped the preamble that fetched the
 * record and computed the derived values, so every case except
 * `disciplinary_routes__3` referenced undefined names (`c`, `s`, `to`, `patch`,
 * `action`, `notes`, `actorId`, `declId`, `hid`, `caseId`, `suspId`) and threw a
 * ReferenceError. The HTTP routes answer 200/201 as soon as the message is
 * queued, so charge-memos, inquiries, findings, penalties, appeals, case
 * closure, suspension revocations, COI declarations and ICC complaints were all
 * reported to the caller as applied while nothing was ever written.
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

const { mockTx, insertValuesMock, updateSetMock, eqOperands, selectResult, R } = vi.hoisted(() => {
  const _insertValuesMock = vi.fn((..._a: any[]): any => undefined);
  const _updateSetMock = vi.fn((..._a: any[]): any => undefined);
  const _eqOperands: unknown[] = [];
  const _selectResult: { current: any[] } = { current: [] };
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: async (v: unknown) => { _insertValuesMock(v); } }),
    update: vi.fn().mockReturnValue({
      set: (v: unknown) => { _updateSetMock(v); return { where: async () => ({ rowCount: 1 }) }; },
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn(async () => _selectResult.current) }),
      }),
    }),
  };
  return {
    mockTx: _mockTx,
    insertValuesMock: _insertValuesMock,
    updateSetMock: _updateSetMock,
    eqOperands: _eqOperands,
    selectResult: _selectResult,
    R: {
      findCaseTx: vi.fn((..._a: any[]): any => undefined),
      updateCase: vi.fn(async (..._a: any[]): Promise<any> => undefined),
      appendEvent: vi.fn(async (..._a: any[]): Promise<any> => undefined),
      insertCase: vi.fn(async (..._a: any[]): Promise<any> => undefined),
      insertSuspension: vi.fn(async (..._a: any[]): Promise<any> => undefined),
      updateSuspension: vi.fn(async (..._a: any[]): Promise<any> => undefined),
    },
  };
});

vi.mock("../../shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(mockTx) },
}));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (..._a: any[]): Promise<any> => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("./repo.js", () => ({
  findCaseTx: (...a: unknown[]) => R.findCaseTx(...a),
  updateCase: (...a: unknown[]) => R.updateCase(...a),
  appendEvent: (...a: unknown[]) => R.appendEvent(...a),
  insertCase: (...a: unknown[]) => R.insertCase(...a),
  insertSuspension: (...a: unknown[]) => R.insertSuspension(...a),
  updateSuspension: (...a: unknown[]) => R.updateSuspension(...a),
}));

// Record every value the consumer compares a column against, so a test can
// assert WHICH row an update targets — the generated `const id = p.id ||
// params.id` always resolves to the throwaway message id.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => { eqOperands.push(val); return { __eq: [col, val] } as any; },
    and: (...parts: unknown[]) => ({ __and: parts }) as any,
  };
});

import { registerF3_disciplinary_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const EMP = "30000000-cccc-4000-8000-000000000001";
const CASE = "40000000-dddd-4000-8000-000000000001";
const DECL = "40000000-dddd-4000-8000-000000000002";
const SUSP = "40000000-dddd-4000-8000-000000000003";
const COMPLAINT = "40000000-dddd-4000-8000-000000000004";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type: COMMANDS.f3RouteWrite,
    tenantId: TENANT,
    actorId: ACTOR,
    correlationId: `corr-${randomUUID()}`,
    schemaVersion: "1.0",
    payload,
  };
}

async function run(payload: Record<string, unknown>): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_disciplinary_Consumers(q);
  await q.start();
  await q.publish(COMMANDS.f3RouteWrite, makeMsg({ tenantId: TENANT, query: {}, ...payload }));
  await q.drain();
  return q;
}

const activeDecl = [{ id: DECL, status: "active", version: 1 }];
const activeSusp = [{ id: SUSP, status: "active", version: 3 }];
const openCase = { id: CASE, tenantId: TENANT, status: "opened", proceedingType: "major", version: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  eqOperands.length = 0;
  selectResult.current = [];
  R.findCaseTx.mockResolvedValue(openCase);
});

const OPS: Array<{ op: string; extra: Record<string, unknown>; rows?: any[] }> = [
  { op: "disciplinary_coi_routes__0", extra: { params: { id: EMP }, body: { declarationType: "coi", declarationDate: "2026-01-01", details: "x" } } },
  { op: "disciplinary_coi_routes__1", extra: { params: { declId: DECL }, body: { reason: "superseded" } }, rows: activeDecl },
  { op: "disciplinary_coi_routes__2", extra: { params: { declId: DECL }, body: {} }, rows: activeDecl },
  { op: "disciplinary_icc_routes__0", extra: { params: {}, body: { complainantId: EMP, summary: "a complaint long enough" } } },
  { op: "disciplinary_icc_routes__1", extra: { params: { id: COMPLAINT }, body: { hearingDate: "2026-02-01" } } },
  { op: "disciplinary_routes__0", extra: { params: { caseId: CASE }, body: {}, caseId: CASE, actorId: ACTOR, to: "charge_memo_issued", action: "charge_memo", notes: "n", patch: {} } },
  { op: "disciplinary_routes__1", extra: { params: { id: EMP }, body: { caseNo: "DC-1", allegation: "x" } } },
  { op: "disciplinary_routes__2", extra: { params: { suspId: SUSP }, body: { revokedDate: "2026-03-01" } }, rows: activeSusp },
  { op: "disciplinary_routes__3", extra: { params: { id: EMP }, body: { fromDate: "2026-01-15", paySuspended: true, subsistencePct: 50 } } },
];

describe("F3 disciplinary consumer — every op runs (previously: ReferenceError on 8 of 9)", () => {
  for (const { op, extra, rows } of OPS) {
    it(`${op} completes without landing in the DLQ`, async () => {
      selectResult.current = rows ?? [];
      const q = await run({ op, id: randomUUID(), ...extra });
      expect(q.dlq).toEqual([]);
      await q.stop();
    });
  }
});

describe("disciplinary_routes__0 (guarded case transition)", () => {
  it("applies the route-computed transition and appends the audit event with the true previous status", async () => {
    const q = await run({
      op: "disciplinary_routes__0", id: randomUUID(),
      params: { caseId: CASE }, body: {},
      caseId: CASE, actorId: ACTOR, to: "inquiry_ordered", action: "order_inquiry",
      notes: "inquiry ordered", patch: { inquiryOfficerId: EMP },
    });
    // The case row is re-fetched inside the consumer transaction (it was never
    // forwarded on the payload) so `fromStatus` and `version` are read at write
    // time rather than from a stale pre-publish snapshot.
    expect(R.findCaseTx).toHaveBeenCalledWith(mockTx, TENANT, CASE);
    expect(R.updateCase).toHaveBeenCalledOnce();
    const [, tenantArg, idArg, patchArg, versionArg] = R.updateCase.mock.calls[0]!;
    expect(tenantArg).toBe(TENANT);
    expect(idArg).toBe(CASE);
    expect(patchArg).toMatchObject({ status: "inquiry_ordered", updatedBy: ACTOR, inquiryOfficerId: EMP });
    expect(versionArg).toBe(2);
    expect(R.appendEvent).toHaveBeenCalledOnce();
    expect(R.appendEvent.mock.calls[0]![1]).toMatchObject({
      tenantId: TENANT, caseId: CASE, fromStatus: "opened", toStatus: "inquiry_ordered",
      action: "order_inquiry", notes: "inquiry ordered", actorId: ACTOR,
    });
    expect(q.dlq).toEqual([]);
    await q.stop();
  });

  it("fails loudly rather than writing when the case no longer exists", async () => {
    R.findCaseTx.mockResolvedValue(null);
    const q = await run({
      op: "disciplinary_routes__0", id: randomUUID(), params: { caseId: CASE }, body: {},
      caseId: CASE, actorId: ACTOR, to: "closed", action: "close", notes: null, patch: {},
    });
    expect(R.updateCase).not.toHaveBeenCalled();
    expect(R.appendEvent).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    await q.stop();
  });
});

describe("disciplinary_routes__1 (open a case)", () => {
  it("opens the case for the employee in the path and applies the proceedingType default", async () => {
    const caseId = randomUUID();
    const q = await run({ op: "disciplinary_routes__1", id: caseId, params: { id: EMP }, body: { caseNo: "DC-7", allegation: "misconduct" } });
    expect(R.insertCase).toHaveBeenCalledOnce();
    expect(R.insertCase.mock.calls[0]![1]).toMatchObject({
      id: caseId, tenantId: TENANT, employeeId: EMP, caseNo: "DC-7",
      // route schema default: proceedingType z.enum([...]).default("major")
      proceedingType: "major", status: "opened",
    });
    expect(R.appendEvent.mock.calls[0]![1]).toMatchObject({ caseId, fromStatus: null, toStatus: "opened", action: "open" });
    await q.stop();
  });
});

describe("disciplinary_routes__2 (revoke suspension)", () => {
  it("revokes the suspension named by :suspId using its live optimistic-lock version", async () => {
    selectResult.current = activeSusp;
    const msgId = randomUUID();
    const q = await run({ op: "disciplinary_routes__2", id: msgId, params: { suspId: SUSP }, body: { revokedDate: "2026-03-01", remarks: "reinstated" } });
    expect(R.updateSuspension).toHaveBeenCalledOnce();
    const [, tenantArg, idArg, patchArg, versionArg] = R.updateSuspension.mock.calls[0]!;
    expect(tenantArg).toBe(TENANT);
    expect(idArg).toBe(SUSP);
    expect(patchArg).toMatchObject({ status: "revoked", paySuspended: false, revokedDate: "2026-03-01", remarks: "reinstated" });
    expect(versionArg).toBe(3);
    expect(eqOperands).toContain(SUSP);
    expect(eqOperands).not.toContain(msgId);
    await q.stop();
  });
});

describe("disciplinary_coi_routes__0 / __1 (COI declarations)", () => {
  it("files the declaration against the employee in the path, keyed by the queued id", async () => {
    const declId = randomUUID();
    const q = await run({ op: "disciplinary_coi_routes__0", id: declId, params: { id: EMP }, body: { declarationType: "gift", declarationDate: "2026-01-01", details: "a watch" } });
    const v = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.id).toBe(declId);
    expect(v.employeeId).toBe(EMP);
    expect(v.declarationType).toBe("gift");
    expect(v.status).toBe("active");
    await q.stop();
  });

  it("revokes the declaration named by :declId, not the throwaway message id", async () => {
    selectResult.current = activeDecl;
    const msgId = randomUUID();
    const q = await run({ op: "disciplinary_coi_routes__1", id: msgId, params: { declId: DECL }, body: { reason: "superseded" } });
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect((updateSetMock.mock.calls[0]![0] as Record<string, unknown>).status).toBe("revoked");
    expect(eqOperands).toContain(DECL);
    expect(eqOperands).not.toContain(msgId);
    await q.stop();
  });
});

describe("disciplinary_icc_routes__1 (ICC hearing)", () => {
  it("attaches the hearing to the complaint in the path", async () => {
    const hid = randomUUID();
    const q = await run({ op: "disciplinary_icc_routes__1", id: hid, params: { id: COMPLAINT }, body: { hearingDate: "2026-02-01", notes: "first sitting" } });
    const v = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.id).toBe(hid);
    expect(v.complaintId).toBe(COMPLAINT);
    expect(v.conductedBy).toBe(ACTOR);
    await q.stop();
  });
});

describe("F3 disciplinary consumer — op routing", () => {
  it("ignores ops that belong to another module's consumer", async () => {
    const q = await run({ op: "some_other_module_routes__0", id: randomUUID(), params: {}, body: {} });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(R.insertCase).not.toHaveBeenCalled();
    expect(q.dlq).toEqual([]);
    await q.stop();
  });
});
