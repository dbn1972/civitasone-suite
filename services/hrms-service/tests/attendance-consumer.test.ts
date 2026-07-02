/**
 * Attendance + Training + Appraisals consumer mock tests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryQueue } from "@civitasone/queue";

const {
  mockTx, dbTransactionFn, enqueuedMessages,
  upsertAttendanceMock, insertRegularisationMock,
} = vi.hoisted(() => {
  const _mockTx = {
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue([]) }) }) }),
  };
  const _dbTransactionFn = vi.fn(async (cb: (tx: unknown) => Promise<void>) => { await cb(_mockTx); });
  const _enqueuedMessages: Array<{ topic: string; payload: unknown }> = [];
  return {
    mockTx: _mockTx,
    dbTransactionFn: _dbTransactionFn as any,
    enqueuedMessages: _enqueuedMessages,
    upsertAttendanceMock: vi.fn(async () => undefined),
    insertRegularisationMock: vi.fn(async () => undefined),
  };
});

vi.mock("../src/shared/db.js", () => ({ db: { transaction: dbTransactionFn } }));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async (_tx: unknown, msg: { topic: string; payload: unknown }) => {
    enqueuedMessages.push({ topic: msg.topic, payload: msg.payload });
  }),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...parts: string[]) => parts.join(":") },
}));
vi.mock("../src/modules/attendance/repo.js", () => ({
  upsertAttendance: (...a: any[]) => upsertAttendanceMock(...a),
  insertRegularisation: (...a: any[]) => insertRegularisationMock(...a),
}));

import { registerAttendanceConsumers } from "../src/modules/attendance/consumer.js";
import { COMMANDS, EVENTS } from "../src/topics.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const ACTOR = "20000000-bbbb-4000-8000-000000000001";

function makeMsg(type: string, payload: Record<string, unknown>) {
  return { messageId: randomUUID(), type, tenantId: TENANT, actorId: ACTOR, correlationId: randomUUID(), schemaVersion: "1.0", payload };
}
async function buildQueue(): Promise<MemoryQueue> {
  const q = new MemoryQueue();
  registerAttendanceConsumers(q);
  await q.start();
  return q;
}
const settle = () => new Promise<void>((r) => setTimeout(r, 100));

beforeEach(() => {
  vi.clearAllMocks();
  enqueuedMessages.length = 0;
  dbTransactionFn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => { await cb(mockTx); });
});

describe("attendanceMark command", () => {
  it("upserts attendance for each record in batch", async () => {
    const q = await buildQueue();
    await q.publish(COMMANDS.attendanceMark, makeMsg(COMMANDS.attendanceMark, {
      batchId: randomUUID(), tenantId: TENANT,
      records: [
        { employeeId: randomUUID(), attendanceDate: "2026-06-01", status: "present" },
        { employeeId: randomUUID(), attendanceDate: "2026-06-01", status: "absent" },
      ],
    }));
    await settle();
    expect(upsertAttendanceMock).toHaveBeenCalledTimes(2);
    // One attendanceMarked per record + one audit
    const marked = enqueuedMessages.filter((m) => m.topic === EVENTS.attendanceMarked);
    expect(marked.length).toBe(2);
    const audit = enqueuedMessages.find((m) => m.topic === "audit.event.record");
    expect(audit).toBeDefined();
    expect((audit!.payload as any).count).toBe(2);
    await q.stop();
  });
});

describe("regularisationCreate command", () => {
  it("inserts regularisation with status 'pending'", async () => {
    const q = await buildQueue();
    const regId = randomUUID();
    await q.publish(COMMANDS.regularisationCreate, makeMsg(COMMANDS.regularisationCreate, {
      id: regId, tenantId: TENANT, employeeId: randomUUID(),
      date: "2026-05-15", requestedStatus: "present", reason: "forgot to mark",
    }));
    await settle();
    expect(insertRegularisationMock).toHaveBeenCalledOnce();
    const row = insertRegularisationMock.mock.calls[0]![1] as Record<string, unknown>;
    expect(row.status).toBe("pending");
    expect(row.requestedStatus).toBe("present");
    await q.stop();
  });
});
