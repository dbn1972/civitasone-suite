import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));

import { createScheme, createCriterion } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * Create commands were NOT exactly-once: messageId was a fresh randomUUID() per call, so a client
 * retry (same X-Idempotency-Key) produced a new messageId and markProcessed() could not dedupe it,
 * persisting a second row for creates without a DB unique constraint. Fix: derive messageId from a
 * command-scoped idempotentId() when the caller supplies a key (random fallback when absent).
 */
describe("grant create commands: idempotent messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("createScheme: no X-Idempotency-Key -> two distinct messageIds (behaviour preserved)", async () => {
    await createScheme(ctx, { name: "s" } as never);
    await createScheme(ctx, { name: "s" } as never);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
  });

  it("createScheme: a retried create with the same X-Idempotency-Key dedupes (one persisted row)", async () => {
    const keyed = { ...ctx, idempotencyKey: "k-1" } as RequestContext;
    await createScheme(keyed, { name: "s" } as never);
    await createScheme(keyed, { name: "s" } as never);
    expect(published[0]!.messageId).toBe(published[1]!.messageId);
  });

  it("different create commands sharing one X-Idempotency-Key do NOT collide (command-scoped)", async () => {
    const keyed = { ...ctx, idempotencyKey: "k-2" } as RequestContext;
    await createScheme(keyed, { name: "s" } as never);
    await createCriterion(keyed, randomUUID(), { label: "c" } as never);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
  });
});
