import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";

const published: Array<{ type: string; messageId: string }> = [];
vi.mock("../../shared/infra.js", () => ({
  queue: { publish: vi.fn(async (type: string, env: { messageId: string }) => { published.push({ type, messageId: env.messageId }); }) },
  cache: { invalidate: vi.fn(async () => undefined), makeKey: (...p: string[]) => p.join(":") },
}));
vi.mock("./repo.js", () => ({
  findApplicationById: vi.fn(async (id: string) => ({ id, submittedBy: "11111111-1111-4111-8111-111111111111", status: "under_review" })),
}));

import { scoreApplication } from "./commands.js";

const ctx = { tenantId: randomUUID(), actorId: randomUUID(), actorType: "user", roles: [], correlationId: randomUUID() } as unknown as RequestContext;

/**
 * REGRESSION (UAT messageId scan, medium confidence): the score messageId was a hash of
 * (application, actor), so the same reviewer scoring the same application a second time was dropped.
 * The path is real: the UI offers "score" on under_review applications, and the consumer now accepts
 * a score on an application already under review.
 */
describe("grant applicationScore: per-command messageId", () => {
  beforeEach(() => { published.length = 0; });
  const body = { reviewerRef: "rev-1", technicalScore: 70, financialScore: 80 } as never;

  it("the same reviewer scoring the same application twice emits two distinct messageIds", async () => {
    const id = randomUUID();
    await scoreApplication(ctx, id, body);
    await scoreApplication(ctx, id, body);
    expect(published[0]!.messageId).not.toBe(published[1]!.messageId);
  });

  it("a client X-Idempotency-Key still dedupes a true double-submit", async () => {
    const id = randomUUID();
    const keyed = { ...ctx, idempotencyKey: "k-1" } as RequestContext;
    await scoreApplication(keyed, id, body);
    await scoreApplication(keyed, id, body);
    expect(published[0]!.messageId).toBe(published[1]!.messageId);
  });
});
