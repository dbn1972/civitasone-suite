/**
 * PHASE-3 FLOW 4 — Contract expiry → Alert.
 *
 * SEAM: contract-service declares the expiry alert event; notification-service
 * consumes it and turns it into a contract-desk notification.
 *   Emitter topic : contract EVENTS.contractExpiryAlert        = "contract.expiry.alert"
 *   Consumer      : notification CONSUMED_EVENTS.contractExpiryAlert = "contract.expiry.alert"
 *
 * (A) EMIT    — contract-service declares exactly one expiry alert event and it
 *     is an EVENT (not a command).
 * (B) CONSUME — the REAL notification registration subscribes to that exact
 *     topic, and the declared consumed-events map carries the same string.
 *
 * HISTORY: an earlier revision of this file proved the seam ORPHANED (no expiry
 * event, no contract.* subscription). contract.expiry.alert has since been added
 * on both sides; this file now proves emitter and consumer agree on the topic.
 *
 * KNOWN LIMIT: this is a topic-contract test. It does not prove a scheduler in
 * contract-service enqueues the event — no producer call site exists yet (expiry
 * is otherwise read-side: GET /v1/contract/contracts/expiring plus renewal-notice
 * dates). Tracked as a follow-up; see the PR description.
 */
import { describe, it, expect, vi } from "vitest";
import { RecordingQueue } from "./_helpers.js";
import { EVENTS as CONTRACT_EVENTS, COMMANDS as CONTRACT_COMMANDS } from "../../services/contract-service/src/topics.js";
import { CONSUMED_EVENTS as NOTIF_CONSUMED } from "../../services/notification-service/src/topics.js";

// notification-service (consumer) data layer
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

const EXPIRY_TOPIC = "contract.expiry.alert";

describe("FLOW 4 — Contract expiry → Alert (WIRED)", () => {
  it("(A) EMIT: contract-service declares exactly one expiry alert event, as an event", () => {
    const eventTopics = Object.values(CONTRACT_EVENTS) as string[];
    const commandTopics = Object.values(CONTRACT_COMMANDS) as string[];
    expect(CONTRACT_EVENTS.contractExpiryAlert).toBe(EXPIRY_TOPIC);
    expect(eventTopics.filter((t) => /expir/i.test(t))).toEqual([EXPIRY_TOPIC]);
    expect(commandTopics.filter((t) => /expir/i.test(t))).toEqual([]);
  });

  it("(B) CONSUME: notification subscribes to the contract expiry alert topic", () => {
    const rq = new RecordingQueue();
    registerDomainEventConsumers(rq.asQueue());
    const contractSubs = [...rq.subscribedTopics].filter((t) => t.startsWith("contract."));
    expect(contractSubs).toEqual([EXPIRY_TOPIC]);
    // Corroborate against the declared consumed-events map too.
    const consumed = Object.values(NOTIF_CONSUMED) as string[];
    expect(consumed.filter((t) => t.startsWith("contract."))).toEqual([EXPIRY_TOPIC]);
  });

  it("emitter and consumer agree on the exact topic string", () => {
    expect(NOTIF_CONSUMED.contractExpiryAlert).toBe(CONTRACT_EVENTS.contractExpiryAlert);
  });
});
