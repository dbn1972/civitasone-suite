/**
 * Unit tests for the no-show detection scheduled worker (Requirements 16.3/16.4)
 * AND Fix 5: the no_show transition, parking-slot release, and noShowDetected
 * event are now written together through the TRANSACTIONAL OUTBOX inside one
 * per-tenant `db.transaction` (via versionedUpdate + enqueue), not raw
 * `queue.publish` outside any tx. Warnings likewise go through `enqueue`.
 *
 * The scan uses a fake BYPASSRLS scanner routed by table; writes use a fake
 * primary `db.transaction`. enqueue + versionedUpdate are mocked so the assertions
 * observe exactly what the worker emits transactionally.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EVENTS, COMMANDS } from "../src/topics.js";
import { NOTIFICATION_SEND } from "@civitasone/events";

const enqueueMock = vi.fn(async () => undefined);
const versionedUpdateMock = vi.fn(async () => undefined);

vi.mock("../src/shared/outbox.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/shared/outbox.js")>()),
  enqueue: (...a: unknown[]) => enqueueMock(...a),
  versionedUpdate: (...a: unknown[]) => versionedUpdateMock(...a),
}));

const { processNoShowCycle } = await import("../src/modules/visit-request/no-show-worker.js");
const { visitRequests } = await import("../src/modules/visit-request/schema.js");
const { checkIns } = await import("../src/modules/check-in/schema.js");
const { digitalPasses } = await import("../src/modules/digital-pass/schema.js");
const { vehiclePasses } = await import("../src/modules/vehicle-pass/schema.js");
const { configEntries } = await import("../src/modules/config-registry/schema.js");

const TENANT = "11111111-1111-1111-1111-111111111111";
const HOST = "22222222-2222-2222-2222-222222222222";
const LOCATION = "33333333-3333-3333-3333-333333333333";

const WARN_MS = 30 * 60_000;
const NO_SHOW_MS = 2 * 60 * 60_000;

function visitRow(overrides: Record<string, unknown> = {}) {
  return {
    id: overrides.id ?? "vr-1",
    tenantId: overrides.tenantId ?? TENANT,
    hostEmployeeId: overrides.hostEmployeeId ?? HOST,
    visitorName: overrides.visitorName ?? "Alice Visitor",
    scheduledAt: overrides.scheduledAt ?? new Date(Date.now() - 3 * 60 * 60_000),
    locationId: overrides.locationId ?? LOCATION,
    version: overrides.version ?? 1,
    purpose: overrides.purpose ?? "Meeting",
  };
}

/** Scanner routed by `.from(table)` identity. */
function fakeScanner(rowsByTable: Map<unknown, unknown[]>) {
  let current: unknown = null;
  const builder: any = {
    from: (t: unknown) => { current = t; return builder; },
    innerJoin: () => builder,
    where: () => Promise.resolve(rowsByTable.get(current) ?? []),
  };
  return { select: () => builder, selectDistinct: () => builder };
}

function fakePrimaryDb(txImpl?: () => Promise<void>) {
  return {
    transaction: async (fn: (tx: unknown) => Promise<void>) => (txImpl ? txImpl() : fn({})),
  };
}

function enqueuedEvents(): any[] {
  return enqueueMock.mock.calls.map((c) => c[1] as any);
}

let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };
beforeEach(() => {
  enqueueMock.mockReset().mockResolvedValue(undefined);
  versionedUpdateMock.mockReset().mockResolvedValue(undefined);
  logger = { info: vi.fn(), warn: vi.fn() };
});

describe("processNoShowCycle — transactional outbox (Fix 5)", () => {
  it("transitions an overdue (2h+) no-check-in visit to no_show and enqueues noShowDetected atomically", async () => {
    const vr = visitRow({ id: "vr-noshow", scheduledAt: new Date(Date.now() - 3 * 60 * 60_000) });
    const map = new Map<unknown, unknown[]>([
      [configEntries, []],
      [checkIns, []],
      [visitRequests, [vr]],
      [vehiclePasses, []],
    ]);
    const scanner = fakeScanner(map);
    const db = fakePrimaryDb();

    const result = await processNoShowCycle(db as any, {} as any, WARN_MS, NO_SHOW_MS, logger, scanner as any);

    expect(result.noShows).toBe(1);
    // versionedUpdate performed the state transition inside the tx.
    expect(versionedUpdateMock).toHaveBeenCalledTimes(1);
    expect(versionedUpdateMock.mock.calls[0]![2]).toMatchObject({
      id: "vr-noshow", set: expect.objectContaining({ status: "no_show" }),
    });
    // noShowDetected event enqueued to the transactional outbox.
    const evt = enqueuedEvents().find((e) => e.topic === EVENTS.noShowDetected);
    expect(evt).toBeDefined();
    expect(evt.payload.id).toBe("vr-noshow");
    expect(evt.actorId).toBe("00000000-0000-0000-0000-000000000000");
  });

  it("also enqueues a parking-slot release when the no-show visit had a vehicle pass", async () => {
    const vr = visitRow({ id: "vr-park", scheduledAt: new Date(Date.now() - 3 * 60 * 60_000) });
    const map = new Map<unknown, unknown[]>([
      [configEntries, []],
      [checkIns, []],
      [visitRequests, [vr]],
      [vehiclePasses, [{ id: "vp-1", parkingSlotId: "slot-1" }]],
    ]);
    const result = await processNoShowCycle(
      fakePrimaryDb() as any, {} as any, WARN_MS, NO_SHOW_MS, logger, fakeScanner(map) as any,
    );

    expect(result.noShows).toBe(1);
    const release = enqueuedEvents().find((e) => e.topic === COMMANDS.parkingSlotRelease);
    expect(release).toBeDefined();
    expect(release.payload).toMatchObject({ vehiclePassId: "vp-1", parkingSlotId: "slot-1", reason: "no_show" });
  });

  it("sends a 30-minute warning (transactionally) for a visit 30m+ but < 2h overdue", async () => {
    const vr = visitRow({ id: "vr-warn", scheduledAt: new Date(Date.now() - 45 * 60_000) });
    const map = new Map<unknown, unknown[]>([
      [configEntries, []],
      [checkIns, []],
      [visitRequests, [vr]],
      [vehiclePasses, []],
    ]);
    const result = await processNoShowCycle(
      fakePrimaryDb() as any, {} as any, WARN_MS, NO_SHOW_MS, logger, fakeScanner(map) as any,
    );

    expect(result.noShows).toBe(0);
    expect(result.warnings).toBe(1);
    expect(versionedUpdateMock).not.toHaveBeenCalled();
    const warn = enqueuedEvents().find((e) => e.topic === NOTIFICATION_SEND);
    expect(warn).toBeDefined();
    expect(warn.payload.recipient).toBe(HOST);
    expect(warn.payload.variables.warningType).toBe("no_show_30m");
  });

  it("skips a visit that already has a check-in (no no_show, no warning)", async () => {
    const vr = visitRow({ id: "vr-checkedin", scheduledAt: new Date(Date.now() - 3 * 60 * 60_000) });
    const map = new Map<unknown, unknown[]>([
      [configEntries, []],
      [checkIns, [{ passId: "p-1" }]],
      [digitalPasses, [{ visitRequestId: "vr-checkedin" }]],
      [visitRequests, [vr]],
      [vehiclePasses, []],
    ]);
    const result = await processNoShowCycle(
      fakePrimaryDb() as any, {} as any, WARN_MS, NO_SHOW_MS, logger, fakeScanner(map) as any,
    );

    expect(result.noShows).toBe(0);
    expect(result.warnings).toBe(0);
    expect(versionedUpdateMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
  });

  it("a version conflict (raced check-in) is caught — the whole unit rolls back, no dup event", async () => {
    const vr = visitRow({ id: "vr-race", scheduledAt: new Date(Date.now() - 3 * 60 * 60_000) });
    const map = new Map<unknown, unknown[]>([
      [configEntries, []],
      [checkIns, []],
      [visitRequests, [vr]],
      [vehiclePasses, []],
    ]);
    // Simulate the tx throwing (versionedUpdate conflict) — the enqueues in the
    // same tx never commit.
    const db = fakePrimaryDb(async () => { throw new Error("VERSION_CONFLICT"); });

    const result = await processNoShowCycle(db as any, {} as any, WARN_MS, NO_SHOW_MS, logger, fakeScanner(map) as any);

    expect(result.noShows).toBe(0);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ visitRequestId: "vr-race", event: "no_show_transition_failed" }),
      expect.any(String),
    );
  });
});
