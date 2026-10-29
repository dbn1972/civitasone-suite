import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string; payload: { id: string } }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string; payload: { id: string } }) => { published.push({ type, messageId: env.messageId, payload: env.payload }); }) },
}));

import { setConfig } from "./commands.js";
import { applyPreset, PRESET_NAMES } from "./presets.js";
import { deriveConfigId } from "./domain.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan): setConfig used messageId = configId (stable per tenant/ns/key), so
 * changing an existing key a second time was dropped; applyPreset used the same configId so it also
 * occupied that inbox slot.
 */
describe("meeting config-registry commands: per-command messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("setConfig twice on the same key: same row id, distinct messageIds (both writes reach the consumer)", async () => {
    await setConfig(ctx, { namespace: "meeting_policy", configKey: "quorum", value: 3 });
    await setConfig(ctx, { namespace: "meeting_policy", configKey: "quorum", value: 5, expectedVersion: 1 });
    expect(published[0]!.payload.id).toBe(published[1]!.payload.id);
    expect(published[0]!.payload.id).toBe(deriveConfigId(ctx.tenantId, "meeting_policy", "quorum"));
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
    expect(published.every((p) => p.messageId !== p.payload.id)).toBe(true);
  });

  it("applyPreset does not occupy the configId inbox slot, so a later manual setConfig is not dropped", async () => {
    await applyPreset(ctx, PRESET_NAMES[0]!);
    const presetIds = new Set(published.map((p) => p.messageId));
    expect(published.every((p) => p.messageId !== p.payload.id)).toBe(true);
    const target = published[0]!.payload.id;
    published.length = 0;
    await setConfig(ctx, { namespace: "x_ns", configKey: "k", value: 1 });
    expect(presetIds.has(published[0]!.messageId)).toBe(false);
    expect(target).toBeTruthy();
  });

  it("re-applying the same preset stays idempotent (deterministic per tenant/preset/entry)", async () => {
    await applyPreset(ctx, PRESET_NAMES[0]!);
    const first = published.map((p) => p.messageId);
    published.length = 0;
    await applyPreset(ctx, PRESET_NAMES[0]!);
    expect(published.map((p) => p.messageId)).toEqual(first);
  });
});
