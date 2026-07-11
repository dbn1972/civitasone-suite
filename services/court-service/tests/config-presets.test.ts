/**
 * Vertical preset onboarding (§47): applyPreset fans out one idempotent
 * config.set per entry; an unknown preset is a 400. The catalog is well-formed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";

const published: Array<{ topic: string; env: { type: string; payload: { namespace: string; configKey: string } } }> = [];
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: vi.fn(async (topic: string, env: unknown) => { published.push({ topic, env: env as never }); return "mid"; }) },
}));

vi.mock("../src/topics.js", () => ({
  COMMANDS: { setConfig: "court.config.set" },
}));

import { applyPreset, getPreset, PRESET_NAMES, VERTICAL_PRESETS } from "../src/modules/config-registry/presets.js";
import { HttpError } from "../src/shared/context.js";

function ctx() {
  return { tenantId: randomUUID(), actorId: randomUUID(), correlationId: "c", roles: ["court_admin"] } as never;
}

describe("config presets — catalog", () => {
  it("exposes the three verticals with non-empty, well-formed entries", () => {
    expect(PRESET_NAMES).toEqual(expect.arrayContaining(["revenue", "consumer", "tribunal"]));
    for (const name of PRESET_NAMES) {
      const entries = getPreset(name)!;
      expect(entries.length).toBeGreaterThan(0);
      for (const e of entries) {
        expect(e.namespace).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
        expect(e.configKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
        expect(e.label.length).toBeGreaterThan(0);
      }
    }
  });

  it("every revenue court_type key is within the varchar(32) column limit", () => {
    for (const e of VERTICAL_PRESETS.revenue!) {
      expect(e.configKey.length).toBeLessThanOrEqual(32);
    }
  });
});

describe("config presets — applyPreset", () => {
  beforeEach(() => { published.length = 0; vi.clearAllMocks(); });

  it("fans out one config.set command per preset entry", async () => {
    const res = await applyPreset(ctx(), "revenue");
    const expected = getPreset("revenue")!.length;
    expect(res).toMatchObject({ accepted: true, preset: "revenue", entries: expected });
    expect(published).toHaveLength(expected);
    expect(published.every((p) => p.topic === "court.config.set")).toBe(true);
    // carries the right namespace/key for the first entry
    expect(published[0]!.env.payload).toMatchObject({ namespace: "court_type", configKey: "tehsildar" });
  });

  it("rejects an unknown preset with a 400 UNKNOWN_PRESET", async () => {
    await expect(applyPreset(ctx(), "made_up_vertical")).rejects.toBeInstanceOf(HttpError);
    await expect(applyPreset(ctx(), "made_up_vertical")).rejects.toMatchObject({ status: 400, code: "UNKNOWN_PRESET" });
    expect(published).toHaveLength(0);
  });

  it("is idempotent-friendly: same tenant+preset derives the same config ids", async () => {
    const c = ctx();
    await applyPreset(c, "consumer");
    const firstIds = published.map((p) => (p.env as { messageId?: string }).messageId ?? JSON.stringify(p.env.payload));
    published.length = 0;
    await applyPreset(c, "consumer");
    const secondIds = published.map((p) => (p.env as { messageId?: string }).messageId ?? JSON.stringify(p.env.payload));
    expect(secondIds).toEqual(firstIds);
  });
});
