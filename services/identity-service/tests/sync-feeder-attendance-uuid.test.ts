import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Queue } from "@civitasone/queue";

const H = vi.hoisted(() => ({
  calls: [] as Array<{ entityId: string; mailbox: string; payload?: Record<string, unknown> }>,
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) },
}));
vi.mock("../src/shared/outbox.js", () => ({ markProcessed: vi.fn(async () => true) }));
vi.mock("../src/modules/devices/repo.js", () => ({
  appendChangelogOne: vi.fn(async (_tx: unknown, e: { entityId: string; mailbox: string; payload?: Record<string, unknown> }) => {
    H.calls.push(e);
    return { seq: "1", etag: "e" };
  }),
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stubQueue() {
  const handlers = new Map<string, (m: unknown) => Promise<void>>();
  const queue = { subscribe: (t: string, h: (m: unknown) => Promise<void>) => { handlers.set(t, h); }, publish: async () => {} } as unknown as Queue;
  return { queue, handler: (t: string) => handlers.get(t)! };
}

const evt = (messageId: string, payload: Record<string, unknown>) =>
  ({ messageId, correlationId: "c", tenantId: "8dcb509d-1a2e-41dc-8dbd-61a3a11b9d93", actorId: "a", payload });

/**
 * REGRESSION (UAT 9 Nov): hrms.attendance.marked fed entityId `${employeeId}:${attendanceDate}` into
 * sync.entity_changelog.entity_id, a uuid column, so every insert threw and attendance never synced.
 */
describe("sync feeder: attendance entity id is a uuid", () => {
  beforeEach(() => { H.calls.length = 0; });

  it("derives a deterministic uuid from employee+date and keeps the raw key in the payload", async () => {
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const { queue, handler } = stubQueue();
    registerSyncFeederConsumers(queue);
    const p = { employeeId: "5f0c2b6e-3a41-4d0e-9a52-7c1d8e4b9a10", attendanceDate: "2026-11-09", status: "present" };

    await handler("hrms.attendance.marked")(evt("m1", p));
    await handler("hrms.attendance.marked")(evt("m2", { ...p, status: "late" }));

    expect(H.calls).toHaveLength(2);
    expect(H.calls[0]!.mailbox).toBe("attendance");
    expect(H.calls[0]!.entityId).toMatch(UUID_RE);
    expect(H.calls[1]!.entityId).toBe(H.calls[0]!.entityId); // same employee+day => same entity
    expect(H.calls[0]!.payload).toMatchObject({ employeeId: p.employeeId, attendanceDate: "2026-11-09", entityKey: `${p.employeeId}:2026-11-09` });
  });

  it("a different day is a different entity; a payload without employeeId/date is skipped", async () => {
    const { registerSyncFeederConsumers } = await import("../src/modules/sync/feeder.js");
    const { queue, handler } = stubQueue();
    registerSyncFeederConsumers(queue);
    const emp = "5f0c2b6e-3a41-4d0e-9a52-7c1d8e4b9a10";

    await handler("hrms.attendance.marked")(evt("m1", { employeeId: emp, attendanceDate: "2026-11-09" }));
    await handler("hrms.attendance.marked")(evt("m2", { employeeId: emp, attendanceDate: "2026-11-10" }));
    await handler("hrms.attendance.marked")(evt("m3", { attendanceDate: "2026-11-10" }));

    expect(H.calls).toHaveLength(2);
    expect(H.calls[0]!.entityId).not.toBe(H.calls[1]!.entityId);
  });
});
