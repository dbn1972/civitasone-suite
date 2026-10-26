/**
 * PHASE-3 FLOW 4 — Contract expiry -> Alert.
 *
 * Seam: contract-service daily expiry sweeper -> contract.expiry.check (command)
 * -> contract.expiry.alert (event) -> notification-service alert.
 *
 * Owner decision #42 built the producer (services/contract-service/src/modules/
 * expiry: sweeper + consumer, migration 0023). The emit behaviour itself
 * (milestone selection, idempotency, RLS-safe cross-tenant scan, exactly-once
 * alert + audit in one transaction) is proven against a live database in
 * services/contract-service/tests/expiry-sweeper.test.ts. This seam test pins
 * the producer/consumer topic contract across the two services:
 *   (A) contract-service declares exactly one expiry EVENT, contract.expiry.alert,
 *       plus the sweeper's contract.expiry.check COMMAND;
 *   (B) notification-service subscribes to that same event string.
 */
import { describe, it, expect, vi } from "vitest";
import { RecordingQueue } from "./_helpers.js";
import { EVENTS as CONTRACT_EVENTS, COMMANDS as CONTRACT_COMMANDS } from "../../services/contract-service/src/topics.js";
import { CONSUMED_EVENTS as NOTIF_CONSUMED } from "../../services/notification-service/src/topics.js";

vi.mock("../../services/notification-service/src/shared/db.js", () => ({ db: {}, sqlClient: {} }));
vi.mock("../../services/notification-service/src/shared/outbox.js", () => ({
  enqueue: async () => {},
  markProcessed: async () => true,
}));
vi.mock("../../services/notification-service/src/shared/infra.js", () => ({
  cache: { invalidate: async () => {}, invalidateResource: async () => {}, makeKey: (...p: string[]) => p.join(":") },
}));

const { registerDomainEventConsumers } = await import(
  "../../services/notification-service/src/modules/domain-events/consumer.js"
);

describe("FLOW 4 — Contract expiry -> Alert", () => {
  it("(A) EMIT: contract-service declares exactly one expiry event and the sweeper command", () => {
    const events = (Object.values(CONTRACT_EVENTS) as string[]).filter((t) => /expir/i.test(t));
    expect(events).toEqual(["contract.expiry.alert"]);
    const commands = (Object.values(CONTRACT_COMMANDS) as string[]).filter((t) => /expir/i.test(t));
    expect(commands).toEqual(["contract.expiry.check"]);
  });

  it("(B) CONSUME: notification subscribes to the same contract.expiry.alert string", () => {
    const rq = new RecordingQueue();
    registerDomainEventConsumers(rq.asQueue());
    expect(rq.subscribedTopics.has(CONTRACT_EVENTS.contractExpiryAlert)).toBe(true);
    expect(NOTIF_CONSUMED.contractExpiryAlert).toBe(CONTRACT_EVENTS.contractExpiryAlert);
  });
});
