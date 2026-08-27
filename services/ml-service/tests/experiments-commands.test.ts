/**
 * Experiment CQRS commands — messageId must always be a valid UUID.
 *
 * markProcessed() (see shared/outbox.ts / @civitasone/outbox) inserts the
 * messageId it is given as the primary key value of `_inbox.processed.
 * message_id`, a `uuid NOT NULL` column. A malformed messageId makes that
 * insert throw, which rolls back the WHOLE consumer transaction — silently
 * dropping the command every single time, even though the HTTP route already
 * returned 202 Accepted (fake success from the caller's point of view).
 *
 * Regression: experimentEnd() used to build `messageId` as
 * `${id}-${Date.now()}`, which is not valid UUID syntax.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { RequestContext } from "@civitasone/types";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const mockPublish = vi.fn().mockResolvedValue(undefined);
vi.mock("../src/shared/infra.js", () => ({
  queue: { publish: (...args: unknown[]) => mockPublish(...args) },
  cache: { getOrLoad: vi.fn(), put: vi.fn(), invalidate: vi.fn() },
}));

let challengerRows: unknown[] = [];
let currentRows: unknown[] = [];
let selectCallCount = 0;

function selectChain(rows: unknown[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => Promise.resolve(rows),
      }),
    }),
  };
}

vi.mock("../src/shared/db.js", () => ({
  db: {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        select: () => {
          selectCallCount++;
          return selectChain(selectCallCount === 1 ? challengerRows : currentRows);
        },
      }),
  },
}));

import { experimentCreate, experimentEnd } from "../src/modules/experiments/commands.js";

const ctx: RequestContext = {
  tenantId: "11111111-1111-1111-1111-111111111111",
  actorId: "22222222-2222-2222-2222-222222222222",
  actorType: "user",
  roles: ["ml_admin"],
  correlationId: "corr-1",
  sessionId: "sess-1",
};

describe("experiments commands — messageId is always a valid UUID", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectCallCount = 0;
    challengerRows = [{ id: "model-a", tenantId: ctx.tenantId, domain: "leads" }];
    currentRows = [{ id: "model-b", tenantId: ctx.tenantId, domain: "leads" }];
  });

  it("experimentCreate publishes a UUID messageId", async () => {
    await experimentCreate(ctx, {
      domain: "leads",
      name: "Test experiment",
      challengerModelId: "model-a",
      currentModelId: "model-b",
      splitPct: 50,
    });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const envelope = mockPublish.mock.calls[0]![1] as { messageId: string };
    expect(envelope.messageId).toMatch(UUID_RE);
  });

  it("experimentEnd publishes a UUID messageId (regression: was `${id}-${Date.now()}`)", async () => {
    await experimentEnd(ctx, "33333333-3333-3333-3333-333333333333", { status: "completed" });

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const envelope = mockPublish.mock.calls[0]![1] as { messageId: string };
    // The old buggy value was `${id}-${Date.now()}` — longer than a UUID and
    // not valid UUID syntax. Matching UUID_RE (exact length + hex groups) is
    // sufficient to catch a regression back to that shape.
    expect(envelope.messageId).toMatch(UUID_RE);
  });
});
