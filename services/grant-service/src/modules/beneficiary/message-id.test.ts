import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));

import { createBeneficiary } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;
const body = { name: "Asha Devi" } as never;

describe("grant createBeneficiary: idempotent messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("no X-Idempotency-Key -> two distinct messageIds", async () => {
    await createBeneficiary(ctx, body);
    await createBeneficiary(ctx, body);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
  });

  it("same X-Idempotency-Key -> identical messageId (retry dedupes)", async () => {
    const keyed = { ...ctx, idempotencyKey: "k-1" } as RequestContext;
    await createBeneficiary(keyed, body);
    await createBeneficiary(keyed, body);
    expect(published[0]!.messageId).toBe(published[1]!.messageId);
  });
});
