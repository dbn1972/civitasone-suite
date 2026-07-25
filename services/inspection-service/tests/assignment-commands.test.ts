/**
 * Unit tests for assignment command publishers, including the SVC-109 tour-plan
 * generate payload carrying an optional geo-located site pool.
 *
 * infra.queue is mocked — these assert envelope wiring, not transport.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { publish } = vi.hoisted(() => ({ publish: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish },
  cache: { makeKey: (...a: string[]) => a.join(":"), invalidate: vi.fn() },
}));

import {
  publishInspectorAssign,
  publishTourPlanGenerate,
  publishGeoAttendanceMark,
  publishTourPlanSubmit,
  publishTourPlanApprove,
} from "../src/modules/assignment/commands.js";

const ctx = {
  tenantId: "t-1",
  actorId: "u-1",
  correlationId: "c-1",
} as unknown as Parameters<typeof publishInspectorAssign>[1];

beforeEach(() => publish.mockClear());

describe("assignment command publishers", () => {
  it("publishInspectorAssign wraps payload + tenant into an envelope", async () => {
    const r = await publishInspectorAssign(
      { inspectionId: "i", inspectorId: "ins", inspectionTypeId: "it", entityId: "e", scheduledDate: "2026-08-01" },
      ctx,
    );
    expect(r.accepted).toBe(true);
    expect(publish).toHaveBeenCalledTimes(1);
    const [, msg] = publish.mock.calls[0]!;
    expect(msg.tenantId).toBe("t-1");
    expect(msg.payload.tenantId).toBe("t-1");
  });

  it("publishTourPlanGenerate carries the SVC-109 geo site pool", async () => {
    const r = await publishTourPlanGenerate(
      {
        inspectorId: "ins",
        periodStart: "2026-08-01",
        periodEnd: "2026-08-05",
        maxDailyInspections: 3,
        sites: [{ entityId: "e1", inspectionId: "i1", latitude: 28.6, longitude: 77.2 }],
        startLatitude: 28.7,
        startLongitude: 77.1,
      },
      ctx,
    );
    expect(r.accepted).toBe(true);
    const [, msg] = publish.mock.calls[0]!;
    expect(msg.payload.sites).toHaveLength(1);
    expect(msg.payload.startLatitude).toBe(28.7);
  });

  it("publishGeoAttendanceMark returns a messageId", async () => {
    const r = await publishGeoAttendanceMark(
      {
        inspectionId: "i", inspectorId: "ins", latitude: "28.6", longitude: "77.2",
        entityLatitude: "28.6", entityLongitude: "77.2", geofenceRadius: 100,
        deviceId: "d", timestamp: "2026-08-01T00:00:00Z",
      },
      ctx,
    );
    expect(r.messageId).toBeDefined();
  });

  it("publishTourPlanSubmit and publishTourPlanApprove publish approval commands", async () => {
    await publishTourPlanSubmit({ tourPlanId: "tp-1" }, ctx);
    await publishTourPlanApprove({ tourPlanId: "tp-1" }, ctx);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
