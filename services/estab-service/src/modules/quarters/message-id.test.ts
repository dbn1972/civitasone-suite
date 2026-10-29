import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
}));

import * as quarters from "./commands.js";
import * as fleet from "../fleet/commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan): every allotment lifecycle step used messageId = allotmentId, the
 * same id quarterApply had already put in _inbox.processed, so allot / occupy / vacation-notice /
 * vacate / cancel were all silently dropped. Same for tripLogComplete (messageId = tripId).
 */
describe("estab commands: per-command messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("apply then allot, occupy, vacation-notice, vacate, cancel: all six messageIds are distinct and none equals the allotment id", async () => {
    const applied = await quarters.applyForAllotment(ctx, { employeeRef: randomUUID() } as never);
    const id = applied.id;
    await quarters.allotQuarter(ctx, id, { version: 1 } as never);
    await quarters.occupyQuarter(ctx, id, { version: 2 } as never);
    await quarters.issueVacationNotice(ctx, id, { version: 3 } as never);
    await quarters.vacateQuarter(ctx, id, { version: 4 } as never);
    await quarters.cancelAllotment(ctx, id, { reason: "x", version: 5 } as never);
    const ids = published.map((p) => p.messageId);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids.slice(1).every((m) => m !== id)).toBe(true);
  });

  it("the same step issued twice (allot, allot) is not collapsed into one inbox key", async () => {
    const id = randomUUID();
    await quarters.allotQuarter(ctx, id, { version: 1 } as never);
    await quarters.allotQuarter(ctx, id, { version: 2 } as never);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
  });

  it("tripLogComplete does not reuse the trip id as its messageId", async () => {
    const trip = await fleet.createTripLog(ctx, { vehicleId: randomUUID() } as never);
    await fleet.completeTrip(ctx, trip.id, { endOdometer: 10, endTime: new Date().toISOString(), version: 1 } as never);
    const ids = published.map((p) => p.messageId);
    expect(new Set(ids).size).toBe(2);
    expect(ids[1]).not.toBe(trip.id);
  });
});
