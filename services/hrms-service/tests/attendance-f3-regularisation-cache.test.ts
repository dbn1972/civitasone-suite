/**
 * Approving a regularisation upserts the employee's attendance row, so the cached tenant-wide attendance list
 * (resource "attendance") must be invalidated too (CLOS3-S5-19, regularisation path).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const H = vi.hoisted(() => ({
  handler: undefined as undefined | ((msg: unknown) => Promise<void>),
  updateRegularisationStatus: vi.fn(),
  upsertAttendance: vi.fn(async () => undefined),
  invalidate: vi.fn(async () => undefined),
  invalidateResource: vi.fn(async () => undefined),
}));

vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb({}) },
}));
vi.mock("../src/shared/infra.js", () => ({
  cache: {
    invalidate: (...a: unknown[]) => H.invalidate(...(a as [])),
    invalidateResource: (...a: unknown[]) => H.invalidateResource(...(a as [])),
    listKey: (...p: string[]) => p.join(":"),
    makeKey: (...p: string[]) => p.join(":"),
  },
}));
vi.mock("../src/shared/outbox.js", () => ({
  enqueue: vi.fn(async () => undefined),
  markProcessed: vi.fn(async () => true),
}));
vi.mock("../src/modules/employee/actor-link.js", () => ({ resolveEmployeeForActor: async () => null }));
vi.mock("../src/modules/attendance/repo.js", () => ({
  updateRegularisationStatus: (...a: unknown[]) => H.updateRegularisationStatus(...(a as [])),
  upsertAttendance: (...a: unknown[]) => H.upsertAttendance(...(a as [])),
}));

import { registerF3_attendance_Consumers } from "../src/modules/attendance/f3-consumer.js";

const TENANT = "10000000-aaaa-4000-8000-000000000001";
const decided = { employeeId: "e1", date: "2026-10-01", requestedStatus: "present" };

async function run(op: string): Promise<void> {
  await H.handler!({
    messageId: `m-${op}-${Math.random()}`, actorId: "a1", correlationId: "c1",
    payload: { op, id: "r1", tenantId: TENANT, body: {}, params: { id: "r1" }, query: {} },
  });
}

describe("regularisation decision cache invalidation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    H.updateRegularisationStatus.mockResolvedValue(decided);
    registerF3_attendance_Consumers({
      subscribe: (_t: string, h: (m: unknown) => Promise<void>) => { H.handler = h; },
    } as never);
  });

  it("approve invalidates the attendance list once", async () => {
    await run("attendance_routes__0");
    expect(H.upsertAttendance).toHaveBeenCalledTimes(1);
    expect(H.invalidateResource).toHaveBeenCalledTimes(1);
    expect(H.invalidateResource).toHaveBeenCalledWith(TENANT, "attendance");
  });

  it("approve of an already-decided request (no write) does not invalidate it", async () => {
    H.updateRegularisationStatus.mockResolvedValue(null);
    await run("attendance_routes__0");
    expect(H.upsertAttendance).not.toHaveBeenCalled();
    expect(H.invalidateResource).not.toHaveBeenCalled();
  });

  it("reject does not touch attendance, so it does not invalidate the attendance list", async () => {
    await run("attendance_routes__1");
    expect(H.upsertAttendance).not.toHaveBeenCalled();
    expect(H.invalidateResource).not.toHaveBeenCalled();
  });
});
