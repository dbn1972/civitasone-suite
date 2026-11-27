import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));

import { submitUc, submitComplianceReport } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

describe("grant utilisation create commands: idempotent messageId", () => {
  beforeEach(() => { published.length = 0; });

  it("submitUc: no key -> distinct, same key -> identical", async () => {
    const appId = randomUUID();
    await submitUc(ctx, appId, {} as never);
    await submitUc(ctx, appId, {} as never);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
    published.length = 0;
    const keyed = { ...ctx, idempotencyKey: "k-1" } as RequestContext;
    await submitUc(keyed, appId, {} as never);
    await submitUc(keyed, appId, {} as never);
    expect(published[0]!.messageId).toBe(published[1]!.messageId);
  });

  it("submitUc and submitComplianceReport sharing one key do NOT collide", async () => {
    const appId = randomUUID();
    const keyed = { ...ctx, idempotencyKey: "k-2" } as RequestContext;
    await submitUc(keyed, appId, {} as never);
    await submitComplianceReport(keyed, appId, {} as never);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
  });
});
