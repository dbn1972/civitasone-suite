/**
 * FQ9 #7 (court): POST /v1/court/config/presets/:preset returned 504 on UAT because
 * applyPreset awaited each config.set publish serially (one broker round trip per entry,
 * back to back, past the gateway's 15s upstream timeout). Entries are independent and
 * idempotent, so they are now published with bounded concurrency.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";

const PUBLISH_MS = 100;
const state = { inFlight: 0, peak: 0, calls: 0 };
vi.mock("../src/shared/infra.js", () => ({
  queue: {
    publish: vi.fn(async () => {
      state.calls += 1;
      state.inFlight += 1;
      state.peak = Math.max(state.peak, state.inFlight);
      await new Promise((r) => setTimeout(r, PUBLISH_MS));
      state.inFlight -= 1;
      return "mid";
    }),
  },
}));

vi.mock("../src/topics.js", () => ({ COMMANDS: { setConfig: "court.config.set" } }));

import { applyPreset, forEachBounded, getPreset, PRESET_PUBLISH_CONCURRENCY } from "../src/modules/config-registry/presets.js";

describe("court presets — bounded-concurrency publish (FQ9 #7)", () => {
  it("forEachBounded never exceeds its limit and visits every item", async () => {
    let inFlight = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachBounded([1, 2, 3, 4, 5], 2, async (n) => {
      inFlight += 1; peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      seen.push(n); inFlight -= 1;
    });
    expect(peak).toBe(2);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5]);
  });

  it("revenue: every entry is published, publishes overlap, and the bound is respected", async () => {
    const entries = getPreset("revenue")!.length;
    const started = Date.now();
    const result = await applyPreset(
      { tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", roles: ["court_admin"] } as never,
      "revenue",
    );
    const elapsed = Date.now() - started;
    expect(result).toMatchObject({ accepted: true, entries });
    expect(state.calls).toBe(entries);
    expect(state.peak).toBeGreaterThan(1);
    expect(state.peak).toBeLessThanOrEqual(PRESET_PUBLISH_CONCURRENCY);
    // Serial would take entries × PUBLISH_MS.
    expect(elapsed).toBeLessThan(entries * PUBLISH_MS * 0.6);
  });
});
