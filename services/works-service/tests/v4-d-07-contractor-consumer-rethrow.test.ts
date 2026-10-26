/**
 * V4-D-07: contractorCreate / contractorRate consumers must rethrow transient
 * (non-NonRetryable) failures so the queue redelivers the accepted command.
 * Swallowing after the transaction rolled back (markProcessed included) lost
 * the command silently.
 */
import { describe, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";

const txFailure = { err: new Error("connection terminated unexpectedly") as Error };
vi.mock("../src/shared/db.js", () => ({
  db: { transaction: async () => { throw txFailure.err; } },
  sqlClient: {},
  scopedRead: async () => [],
}));
vi.mock("../src/shared/tenant-queue.js", () => ({ tenantScoped: (q: unknown) => q }));

import { registerContractorConsumers } from "../src/modules/contractor/consumer.js";
import { COMMANDS } from "../src/topics.js";

type Handler = (msg: unknown) => Promise<void>;
const handlers: Record<string, Handler> = {};
registerContractorConsumers({ subscribe: (t: string, fn: Handler) => { handlers[t] = fn; } } as never);

const msg = (payload: Record<string, unknown>) => ({
  messageId: randomUUID(), tenantId: randomUUID(), actorId: randomUUID(), correlationId: randomUUID(), payload,
});

describe("V4-D-07 contractor consumers rethrow transient errors", () => {
  it("contractorCreate rejects (redelivery) on a transient DB error", async () => {
    await expect(handlers[COMMANDS.contractorCreate]!(msg({ id: randomUUID(), name: "Acme Infra" })))
      .rejects.toThrow("connection terminated unexpectedly");
  });
  it("contractorRate rejects (redelivery) on a transient DB error", async () => {
    await expect(handlers[COMMANDS.contractorRate]!(msg({ id: randomUUID(), rating: 4 })))
      .rejects.toThrow("connection terminated unexpectedly");
  });
});
