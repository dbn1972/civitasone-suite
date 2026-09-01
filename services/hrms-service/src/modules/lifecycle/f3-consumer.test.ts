/**
 * F3 lifecycle consumer — unit tests.
 *
 * Regression cover for the "generated F3 leftover consumer" bug class first
 * found in `leave_policy_admin_routes__0`: the generator that stubbed each route
 * down to a bare `publishF3Write(...)` dropped the preamble that defined the
 * handler's locals, so every case here referenced an undefined name (`bid`,
 * `pid`, `mid`, `holdId`, `tid`, `taskId`) and threw a ReferenceError. The HTTP
 * routes answer 200/201 as soon as the message is queued, so all thirteen ops
 * were fake successes — the caller was told the write happened while this
 * consumer crashed before touching the database.
 *
 * The `every op completes without landing in the DLQ` test below is the direct
 * regression guard: it fails loudly for ANY op that throws, which is exactly
 * what the original bug did on every single invocation.
 *
 * Follows the MemoryQueue + mocked db.transaction pattern of
 * ../leave/f3-consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, insertValuesMock, updateSetMock, eqOperands, selectResult } = vi.hoisted(() => {
  const _insertValuesMock = vi.fn((..._a: any[]): any => undefined);
  const _updateSetMock = vi.fn((..._a: any[]): any => undefined);
  const _eqOperands: unknown[] = [];
  const _selectResult: { current: any[] } = { current: [] };
  const _mockTx = {
    insert: vi.fn().mockReturnValue({
      values: async (v: unknown) => { _insertValuesMock(v); },
    }),
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
  };
});

vi.mock("../../shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<void>) => cb(mockTx) },
}));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (..._a: any[]): Promise<any> => undefined),
  markProcessed: vi.fn(async () => true),
}));

// Record every value the consumer compares a column against, so a test can
// assert WHICH id an update targets. The generated `const id = p.id ||
// params.id` always resolves to the throwaway message id, so an update keyed
// off it silently matches zero rows — these assertions pin that down.
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => { eqOperands.push(val); return { __eq: [col, val] } as any; },
    and: (...parts: unknown[]) => ({ __and: parts }) as any,
  };
});

import { registerF3_lifecycle_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const OTHER = "20000000-bbbb-4000-8000-000000000002";
const EMP = "30000000-cccc-4000-8000-000000000001";

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

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_lifecycle_Consumers(q);
  await q.start();
  return q;
}

/** Publish one op, wait for the handler to settle, return the queue. */
async function run(payload: Record<string, unknown>): Promise<MemoryQueue> {
  const q = await buildQueue();
  await q.publish(COMMANDS.f3RouteWrite, makeMsg({ tenantId: TENANT, query: {}, ...payload }));
  await q.drain();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  eqOperands.length = 0;
  selectResult.current = [];
});

/**
 * One representative envelope per op, shaped exactly as the route publishes it:
 * `id` is a throwaway uuid the route passes to publishF3Write, and the entity
 * the route addresses lives in `params`.
 */
const HOLD = "40000000-dddd-4000-8000-000000000001";
const CHECK = "40000000-dddd-4000-8000-000000000002";
const PROP = "40000000-dddd-4000-8000-000000000003";
const TASK = "40000000-dddd-4000-8000-000000000004";

const pendingHold = [{ id: HOLD, status: "pending", requestedBy: OTHER, version: 1 }];
const activeHold = [{ id: HOLD, status: "active", requestedBy: OTHER, version: 1 }];

const OPS: Array<{ op: string; params: Record<string, unknown>; body: Record<string, unknown>; rows?: any[] }> = [
  { op: "lifecycle_bgv_property_policy_routes__0", params: { id: EMP }, body: { checkType: "police", provider: "acme" } },
  { op: "lifecycle_bgv_property_policy_routes__1", params: { id: CHECK }, body: { status: "passed", result: "clear" } },
  { op: "lifecycle_bgv_property_policy_routes__2", params: { id: EMP }, body: { itemDescription: "laptop" } },
  { op: "lifecycle_bgv_property_policy_routes__3", params: { id: PROP }, body: {} },
  { op: "lifecycle_bgv_property_policy_routes__4", params: {}, body: { employeeType: "permanent", docType: "pan" } },
  { op: "lifecycle_bgv_property_policy_routes__5", params: { id: EMP }, body: { policyName: "code of conduct" } },
  { op: "lifecycle_hold_routes__0", params: { id: EMP }, body: { holdType: "salary", reason: "audit", effectiveFrom: "2026-01-01" } },
  { op: "lifecycle_hold_routes__1", params: { holdId: HOLD }, body: {}, rows: pendingHold },
  { op: "lifecycle_hold_routes__2", params: { holdId: HOLD }, body: { reason: "not justified" }, rows: pendingHold },
  { op: "lifecycle_hold_routes__3", params: { holdId: HOLD }, body: { reason: "cleared" }, rows: activeHold },
  { op: "lifecycle_onboarding_routes__0", params: { id: EMP }, body: { title: "collect ID card", dueByDay: 3 } },
  { op: "lifecycle_onboarding_routes__1", params: { taskId: TASK }, body: {} },
  { op: "lifecycle_onboarding_routes__2", params: { id: EMP }, body: { buddyId: OTHER, role: "mentor" } },
];

describe("F3 lifecycle consumer — every op runs (previously: ReferenceError on all 13)", () => {
  for (const { op, params, body, rows } of OPS) {
    it(`${op} completes without landing in the DLQ`, async () => {
      selectResult.current = rows ?? [];
      const q = await run({ op, id: randomUUID(), params, body });
      expect(q.dlq).toEqual([]);
      await q.stop();
    });
  }
});

describe("lifecycle_bgv_property_policy_routes__0 (create BGV check)", () => {
  it("inserts the check under the employee from the route path, keyed by the queued id", async () => {
    const rowId = randomUUID();
    const q = await run({ op: "lifecycle_bgv_property_policy_routes__0", id: rowId, params: { id: EMP }, body: { checkType: "police", provider: "acme" } });
    expect(insertValuesMock).toHaveBeenCalledOnce();
    const v = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.id).toBe(rowId);
    expect(v.tenantId).toBe(TENANT);
    // Regression: `employeeId` used to read the generated `id` local, i.e. the
    // throwaway message id, not the employee the route was called for.
    expect(v.employeeId).toBe(EMP);
    expect(v.checkType).toBe("police");
    expect(v.provider).toBe("acme");
    expect(v.createdBy).toBe(ACTOR);
    await q.stop();
  });
});

describe("lifecycle_bgv_property_policy_routes__1 (complete BGV check)", () => {
  it("targets the check id from the route path, not the throwaway message id", async () => {
    const msgId = randomUUID();
    const q = await run({ op: "lifecycle_bgv_property_policy_routes__1", id: msgId, params: { id: CHECK }, body: { status: "passed", result: "clear" } });
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect((updateSetMock.mock.calls[0]![0] as Record<string, unknown>).status).toBe("passed");
    expect(eqOperands).toContain(CHECK);
    expect(eqOperands).not.toContain(msgId);
    await q.stop();
  });
});

describe("lifecycle_bgv_property_policy_routes__4 (mandatory-doc config)", () => {
  it("applies the route schema's `required` default when the caller omits it", async () => {
    const q = await run({ op: "lifecycle_bgv_property_policy_routes__4", id: randomUUID(), params: {}, body: { employeeType: "permanent", docType: "pan" } });
    const v = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.required).toBe(true);
    await q.stop();
  });
});

describe("lifecycle_hold_routes__0 (request hold)", () => {
  it("inserts a pending hold for the employee in the path, keyed by the queued id", async () => {
    const holdId = randomUUID();
    const q = await run({ op: "lifecycle_hold_routes__0", id: holdId, params: { id: EMP }, body: { holdType: "salary", reason: "audit", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-01" } });
    const v = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(v.id).toBe(holdId);
    expect(v.employeeId).toBe(EMP);
    expect(v.status).toBe("pending");
    expect(v.requestedBy).toBe(ACTOR);
    expect(v.effectiveTo).toBe("2026-03-01");
    await q.stop();
  });
});

describe("lifecycle_hold_routes__1 (approve hold)", () => {
  it("approves the hold named by :holdId and records the approver", async () => {
    selectResult.current = pendingHold;
    const msgId = randomUUID();
    const q = await run({ op: "lifecycle_hold_routes__1", id: msgId, params: { holdId: HOLD }, body: {} });
    expect(updateSetMock).toHaveBeenCalledOnce();
    const patch = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.status).toBe("active");
    expect(patch.approvedBy).toBe(ACTOR);
    expect(eqOperands).toContain(HOLD);
    expect(eqOperands).not.toContain(msgId);
    await q.stop();
  });

  it("still enforces separation of duties: the requester cannot approve their own hold", async () => {
    selectResult.current = [{ id: HOLD, status: "pending", requestedBy: ACTOR, version: 1 }];
    const q = await run({ op: "lifecycle_hold_routes__1", id: randomUUID(), params: { holdId: HOLD }, body: {} });
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toContain("must not be the same person");
    await q.stop();
  });
});

describe("lifecycle_onboarding_routes__1 (complete onboarding task)", () => {
  it("targets :taskId from the route path, not the throwaway message id", async () => {
    const msgId = randomUUID();
    const q = await run({ op: "lifecycle_onboarding_routes__1", id: msgId, params: { taskId: TASK }, body: {} });
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect((updateSetMock.mock.calls[0]![0] as Record<string, unknown>).status).toBe("completed");
    expect(eqOperands).toContain(TASK);
    expect(eqOperands).not.toContain(msgId);
    await q.stop();
  });
});

describe("F3 lifecycle consumer — op routing", () => {
  it("ignores ops that belong to another module's consumer", async () => {
    const q = await run({ op: "some_other_module_routes__0", id: randomUUID(), params: {}, body: {} });
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(q.dlq).toEqual([]);
    await q.stop();
  });
});
