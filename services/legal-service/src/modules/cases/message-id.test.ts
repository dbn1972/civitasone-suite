import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
  cache: { put: vi.fn(async () => undefined), invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));

import { createCase, disposeCase } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan): createCase publishes with messageId = caseId and disposeCase used
 * messageId = caseId too, so the dispose was ALWAYS dropped by the inbox.
 */
describe("legal case commands: per-command messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("disposeCase does not reuse the case id (createCase's inbox key)", async () => {
    const created = await createCase(ctx, { title: "t", court: "c", courtCode: "C", courtVerified: true } as never);
    await disposeCase(ctx, created.id, { disposition: "dismissed" } as never);
    expect(published[0]!.messageId).toBe(created.id);
    expect(published[1]!.messageId).not.toBe(created.id);
  });

  it("without a client idempotency key two disposes get distinct ids; with the same key they dedupe", async () => {
    const id = randomUUID();
    await disposeCase(ctx, id, { disposition: "a" } as never);
    await disposeCase(ctx, id, { disposition: "a" } as never);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);

    published.length = 0;
    const keyed = { ...ctx, idempotencyKey: "client-key-1" } as RequestContext;
    await disposeCase(keyed, id, { disposition: "a" } as never);
    await disposeCase(keyed, id, { disposition: "a" } as never);
    expect(published[0]!.messageId).toBe(published[1]!.messageId);
    // ...and the key is scoped to the command + case, not shared with other commands
    expect(published[0]!.messageId).not.toBe(id);
  });
});
