/**
 * F3 face-verification consumer — unit tests.
 *
 * Same bug class as the leave fix documented in ../leave/f3-consumer.test.ts:
 * `face_verification_routes__0` (upload profile photo) referenced `existing`
 * and `photoId`, which the code-gen never defined, so it threw a
 * ReferenceError on every invocation while POST
 * /v1/hrms/employees/:id/profile-photo had already answered 201 "uploaded".
 * No photo row was ever written — which meant attendance face verification
 * could never be used by anyone.
 *
 * `face_verification_routes__1` (verification audit log) is STILL broken by
 * design — see the KNOWN GAP test at the bottom and the
 * TODO(unresolved-f3-bug) in f3-consumer.ts.
 *
 * Driven directly over a MemoryQueue (as ../leave/f3-consumer.test.ts does)
 * because the F3 consumers are registered only in worker.ts, never in app.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const { mockTx, dbTransactionFn, selectResult, insertValuesMock, updateSetMock, updateWhereMock } = vi.hoisted(() => {
  const _insertValuesMock = vi.fn(async (..._a: any[]) => undefined);
  const _updateWhereMock = vi.fn(async (..._a: any[]) => undefined);
  const _updateSetMock = vi.fn().mockReturnValue({ where: (...a: unknown[]) => _updateWhereMock(...(a as [])) });
  const _selectResult: { current: any[] } = { current: [] };
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: (v: unknown) => _insertValuesMock(v) }),
    update: vi.fn().mockReturnValue({ set: _updateSetMock }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({ limit: vi.fn(async (..._a: any[]) => _selectResult.current) }),
      }),
    }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  return {
    mockTx: _mockTx, dbTransactionFn: _dbTransactionFn, selectResult: _selectResult,
    insertValuesMock: _insertValuesMock, updateSetMock: _updateSetMock, updateWhereMock: _updateWhereMock,
  };
});

vi.mock("../../shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../../shared/outbox.js", () => ({
  enqueue: vi.fn(async (..._a: any[]) => undefined),
  markProcessed: vi.fn(async (..._a: any[]) => true),
}));

import { registerF3_face_verification_Consumers } from "./f3-consumer.js";
import { COMMANDS } from "../../topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";
const EMPLOYEE = "30000000-cccc-4000-8000-000000000001";

function makeMsg(payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type: COMMANDS.f3RouteWrite, tenantId: TENANT,
    actorId: ACTOR, correlationId: `corr-${randomUUID()}`, schemaVersion: "1.0", payload,
  };
}

async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue({ maxAttempts: 1 });
  registerF3_face_verification_Consumers(q);
  await q.start();
  return q;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResult.current = [];
  updateSetMock.mockReturnValue({ where: (...a: unknown[]) => updateWhereMock(...(a as [])) });
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("face_verification_routes__0 (upload profile photo)", () => {
  it("inserts the photo instead of throwing ReferenceError: existing is not defined", async () => {
    const q = await buildQueue();
    const photoId = randomUUID();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "face_verification_routes__0", id: photoId, tenantId: TENANT,
      body: { photoKey: "photos/emp-1.jpg", photoBucket: "civitasone-photos" },
      params: { id: EMPLOYEE }, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(insertValuesMock).toHaveBeenCalledOnce();
    const row = insertValuesMock.mock.calls[0]![0] as Record<string, any>;
    expect(row.id).toBe(photoId);
    expect(row.tenantId).toBe(TENANT);
    // Regression guard for the second defect: the employee must come from the
    // URL path param, NOT from the publish-time uuid in `p.id`.
    expect(row.employeeId).toBe(EMPLOYEE);
    expect(row.photoKey).toBe("photos/emp-1.jpg");
    expect(row.isActive).toBe(true);
    // No prior photo → nothing to deactivate.
    expect(updateSetMock).not.toHaveBeenCalled();
    await q.stop();
  });

  it("deactivates the previous photo before inserting the replacement", async () => {
    selectResult.current = [{ id: "old-photo-1", employeeId: EMPLOYEE, isActive: true }];
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "face_verification_routes__0", id: randomUUID(), tenantId: TENANT,
      body: { photoKey: "photos/emp-1-v2.jpg", photoBucket: "civitasone-photos" },
      params: { id: EMPLOYEE }, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(updateSetMock).toHaveBeenCalledOnce();
    expect(updateSetMock.mock.calls[0]![0]).toMatchObject({ isActive: false });
    expect(insertValuesMock).toHaveBeenCalledOnce();
    expect((insertValuesMock.mock.calls[0]![0] as Record<string, any>).isActive).toBe(true);
    await q.stop();
  });

  it("defaults photoBucket the same way the route's Zod schema does", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "face_verification_routes__0", id: randomUUID(), tenantId: TENANT,
      body: { photoKey: "photos/emp-1.jpg" }, params: { id: EMPLOYEE }, query: {},
    }));
    await q.drain();
    expect((insertValuesMock.mock.calls[0]![0] as Record<string, any>).photoBucket).toBe("civitasone-photos");
    await q.stop();
  });
});

describe("face_verification_routes__2 (admin face config)", () => {
  it("updates only the six allow-listed settings", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "face_verification_routes__2", id: randomUUID(), tenantId: TENANT,
      body: { onnxEnabled: false, onnxThreshold: 0.82, requireFaceMatch: false },
      params: {}, query: {},
    }));
    await q.drain();

    expect(q.dlq).toHaveLength(0);
    expect(updateSetMock).toHaveBeenCalledOnce();
    const patch = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.onnxEnabled).toBe(false);
    // numeric(5,4) column — must be written as a string
    expect(patch.onnxThreshold).toBe("0.82");
    expect(patch.requireFaceMatch).toBe(false);
    expect(patch.updatedAt).toBeInstanceOf(Date);
    // untouched settings must not appear in the patch at all
    expect("rekognitionEnabled" in patch).toBe(false);
    expect("allowManualOverride" in patch).toBe(false);
    await q.stop();
  });

  it("ignores unknown keys in the raw body (the queued body never went through Zod)", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "face_verification_routes__2", id: randomUUID(), tenantId: TENANT,
      body: { onnxEnabled: true, tenantId: "99999999-9999-4000-8000-000000000009", id: "hijacked" },
      params: {}, query: {},
    }));
    await q.drain();

    const patch = updateSetMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(patch.onnxEnabled).toBe(true);
    // A caller must not be able to repoint the row at another tenant.
    expect("tenantId" in patch).toBe(false);
    expect("id" in patch).toBe(false);
    await q.stop();
  });
});

describe("face_verification_routes__1 (verification audit log)", () => {
  it("KNOWN GAP: still dead-letters — the match result is not carried in the payload", async () => {
    // `result` comes from verifyFace(), which issues a live AWS Rekognition
    // CompareFaces call and is neither pure nor free. Re-running it here could
    // write an audit row whose is_match CONTRADICTS the verdict the caller was
    // already given and acted on, so this case is deliberately left unfixed
    // until the route forwards the result it already has.
    // See TODO(unresolved-f3-bug) in f3-consumer.ts.
    //
    // WHEN THE ROUTE IS FIXED: delete this test and assert the logged row
    // matches the verdict the route returned.
    const q = await buildQueue();
    await q.publish(COMMANDS.f3RouteWrite, makeMsg({
      op: "face_verification_routes__1", id: randomUUID(), tenantId: TENANT,
      body: { employeeId: EMPLOYEE, selfieKey: "selfies/x.jpg" }, params: {}, query: {},
    }));
    await q.drain();

    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(q.dlq).toHaveLength(1);
    expect(q.dlq[0]!.error).toMatch(/is not defined/);
    await q.stop();
  });
});
