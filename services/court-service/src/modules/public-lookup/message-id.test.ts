import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string; payload: { id: string } }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string; payload: { id: string } }) => { published.push({ type, messageId: env.messageId, payload: env.payload }); }) },
}));

import { publishEstablishment } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan): the access-mode setConfig fan-out used messageId = configId (stable),
 * so changing accessMode via a later publishEstablishment was dropped.
 */
describe("court public-lookup: accessMode setConfig messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("publishing with accessMode otp then captcha emits two setConfig commands with distinct messageIds for the same config row", async () => {
    const body = { establishmentCode: "DLHC01", courtName: "HC", publicSlug: "hc-delhi" };
    await publishEstablishment(ctx, { ...body, accessMode: "otp" });
    await publishEstablishment(ctx, { ...body, accessMode: "captcha" });
    const sets = published.filter((p) => p.type.endsWith("config.set"));
    expect(sets).toHaveLength(2);
    expect(sets[0]!.payload.id).toBe(sets[1]!.payload.id);
    expect(sets[0]!.messageId).not.toBe(sets[1]!.messageId);
    expect(sets.every((s) => s.messageId !== s.payload.id)).toBe(true);
  });
});
