import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
}));

import { createMatch, resolveMatch } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan): markProcessed() keys _inbox.processed on message_id alone, so a
 * follow-up command published with messageId = <entity id> collided with the create's inbox row and
 * was silently dropped (202, nothing happened).
 */
describe("matching commands: per-command messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("resolveMatch never reuses the match id (the create's inbox key) as its messageId", async () => {
    const created = await createMatch(ctx, {
      poId: randomUUID(), poLineId: randomUUID(), grnId: randomUUID(), invoiceId: randomUUID(),
      poQty: 1, poRatePaise: 100, grnQty: 1, invoiceQty: 1, invoiceRatePaise: 100,
    } as never);
    await resolveMatch(ctx, created.id, 1, "ok");
    const ids = published.map((p) => p.messageId);
    expect(ids[0]).toBe(created.id); // create keeps its fresh entity id
    expect(ids[1]).not.toBe(created.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("two resolve commands on the same match get distinct messageIds (both reach the consumer)", async () => {
    const id = randomUUID();
    await resolveMatch(ctx, id, 1, "first");
    await resolveMatch(ctx, id, 2, "second");
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
    expect(published.every((p) => p.messageId !== id)).toBe(true);
  });
});
