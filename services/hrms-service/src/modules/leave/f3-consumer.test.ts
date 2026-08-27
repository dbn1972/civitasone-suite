/**
 * F3 leave-policy consumer — unit tests.
 *
 * HR-A deep-verify finding (leave-policies page): `leave_policy_admin_routes__0`
 * (create leave policy) referenced an undefined `upsertValues` local — a
 * leftover from this file's generated-migration origin (see the @ts-nocheck
 * banner in f3-consumer.ts) — and threw a ReferenceError on every single
 * invocation. Because POST /v1/hrms/admin/leave-policies answers 201
 * "created" as soon as the message is queued (fire-and-forget — see
 * policy-admin-routes.ts), every create-policy submission was a fake
 * success: the client was told it worked while this async consumer crashed
 * before ever inserting a row. `leave_policy_admin_routes__1` (update) had
 * the same class of bug: `HttpError` was thrown on a not-found id but never
 * imported into this file.
 *
 * Follows the same MemoryQueue + mocked db.transaction pattern as the
 * sibling ./consumer.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";
import { HttpError } from "../../shared/context.js";

const {
  mockTx,
  dbTransactionFn,
  insertValuesMock,
  onConflictDoUpdateMock,
  updateSetMock,
  selectResult,
} = vi.hoisted(() => {
  const _insertValuesMock = vi.fn();
  const _onConflictDoUpdateMock = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "row-1" }]) });
  const _updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
  const _selectResult: { current: any[] } = { current: [] };
  const _mockTx = {
    insert: vi.fn().mockReturnValue({
      values: (v: unknown) => {
        _insertValuesMock(v);
        return { onConflictDoUpdate: _onConflictDoUpdateMock };
      },
    }),
    update: vi.fn().mockReturnValue({ set: _updateSetMock }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn(async () => _selectResult.current) }),
      }),
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(_mockTx);
  });
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn,
    insertValuesMock: _insertValuesMock,
    onConflictDoUpdateMock: _onConflictDoUpdateMock,
    updateSetMock: _updateSetMock,
    selectResult: _selectResult,
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));

import { registerF3_leave_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

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
  const q = new MemoryQueue();
  registerF3_leave_Consumers(q);
  await q.start();
  return q;
}

/** Wait for all in-flight async handlers to drain. */
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  selectResult.current = [];
  onConflictDoUpdateMock.mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: "row-1" }]) });
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    await cb(mockTx);
  });
});

describe("leave_policy_admin_routes__0 (create policy)", () => {
  it("inserts every field the create-policy form submits (previously: ReferenceError, upsertValues is not defined)", async () => {
    const q = await buildQueue();
    const policyId = randomUUID();
    const leaveTypeId = randomUUID();
    await q.publish(
      COMMANDS.f3RouteWrite,
      makeMsg({
        op: "leave_policy_admin_routes__0",
        id: policyId,
        tenantId: TENANT,
        body: {
          leaveTypeId, employeeType: "permanent", maxDaysPerYear: 30,
          carryForward: true, maxAccumulation: 60, encashable: true,
          countMethod: "working_days", maxContinuousDays: 90, minServiceMonths: 6,
          genderRestriction: null, requiresMedicalCert: true, requiresMedicalCertAfterDays: 3,
          prefixSuffixRule: true, sandwichRule: false, proRataOnJoining: true,
        },
        params: {},
        query: {},
      }),
    );
    await settle();

    expect(insertValuesMock).toHaveBeenCalledOnce();
    const inserted = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted.id).toBe(policyId);
    expect(inserted.tenantId).toBe(TENANT);
    expect(inserted.leaveTypeId).toBe(leaveTypeId);
    expect(inserted.employeeType).toBe("permanent");
    expect(inserted.maxDaysPerYear).toBe(30);
    expect(inserted.carryForward).toBe(true);
    expect(inserted.maxAccumulation).toBe(60);
    expect(inserted.encashable).toBe(true);
    expect(inserted.countMethod).toBe("working_days");
    expect(inserted.maxContinuousDays).toBe(90);
    expect(inserted.minServiceMonths).toBe(6);
    expect(inserted.requiresMedicalCert).toBe(true);
    expect(inserted.requiresMedicalCertAfterDays).toBe(3);
    expect(inserted.prefixSuffixRule).toBe(true);
    expect(inserted.sandwichRule).toBe(false);
    expect(inserted.proRataOnJoining).toBe(true);
    expect(inserted.createdBy).toBe(ACTOR);
    expect(inserted.updatedBy).toBe(ACTOR);
    await q.stop();
  });

  it("defaults optional fields the same way createPolicyBody's Zod schema does, when a caller omits them", async () => {
    const q = await buildQueue();
    const leaveTypeId = randomUUID();
    await q.publish(
      COMMANDS.f3RouteWrite,
      makeMsg({
        op: "leave_policy_admin_routes__0",
        id: randomUUID(),
        tenantId: TENANT,
        body: { leaveTypeId, employeeType: "consultant", maxDaysPerYear: 10 },
        params: {},
        query: {},
      }),
    );
    await settle();

    expect(insertValuesMock).toHaveBeenCalledOnce();
    const inserted = insertValuesMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted.carryForward).toBe(false);
    expect(inserted.maxAccumulation).toBe(0);
    expect(inserted.encashable).toBe(false);
    expect(inserted.countMethod).toBe("calendar");
    expect(inserted.maxContinuousDays).toBe(365);
    expect(inserted.minServiceMonths).toBe(0);
    expect(inserted.genderRestriction).toBe(null);
    expect(inserted.requiresMedicalCert).toBe(false);
    expect(inserted.requiresMedicalCertAfterDays).toBe(3);
    expect(inserted.prefixSuffixRule).toBe(false);
    expect(inserted.sandwichRule).toBe(false);
    expect(inserted.proRataOnJoining).toBe(true);
    await q.stop();
  });

  it("ignores ops that don't belong to this consumer", async () => {
    const q = await buildQueue();
    await q.publish(
      COMMANDS.f3RouteWrite,
      makeMsg({ op: "some_other_module_routes__0", id: randomUUID(), tenantId: TENANT, body: {}, params: {}, query: {} }),
    );
    await settle();
    expect(insertValuesMock).not.toHaveBeenCalled();
    await q.stop();
  });
});

describe("leave_policy_admin_routes__1 (update policy)", () => {
  it("updates an existing policy's fields", async () => {
    selectResult.current = [{ id: "policy-1", tenantId: TENANT }];
    const q = await buildQueue();
    await q.publish(
      COMMANDS.f3RouteWrite,
      makeMsg({
        op: "leave_policy_admin_routes__1",
        id: "policy-1",
        tenantId: TENANT,
        body: { maxDaysPerYear: 45 },
        params: { id: "policy-1" },
        query: {},
      }),
    );
    await settle();
    expect(updateSetMock).toHaveBeenCalledOnce();
    const patch = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.maxDaysPerYear).toBe(45);
    await q.stop();
  });

  it("throws a real HttpError (not a ReferenceError) when the policy id does not exist", async () => {
    selectResult.current = [];
    let caught: unknown = null;
    dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
      try {
        await cb(mockTx);
      } catch (e) {
        caught = e;
        throw e;
      }
    });
    const q = await buildQueue();
    await q.publish(
      COMMANDS.f3RouteWrite,
      makeMsg({
        op: "leave_policy_admin_routes__1",
        id: "missing-policy",
        tenantId: TENANT,
        body: { maxDaysPerYear: 45 },
        params: { id: "missing-policy" },
        query: {},
      }),
    );
    await settle();
    expect(updateSetMock).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(HttpError);
    expect((caught as HttpError).status).toBe(404);
    await q.stop();
  });
});
