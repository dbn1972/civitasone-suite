/**
 * PHASE-3 FLOW 4 — Contract expiry → Alert.  ***ORPHANED / BROKEN***
 *
 * EXPECTED seam: contract-service expiry detection → notification-service alert.
 *
 * FINDINGS:
 *  1. contract-service emits NO expiry/expiring event. Its EVENTS map covers
 *     created/approved/activated/closed/terminated/amended, clause/template/
 *     obligation/renewal/approval-level/esign — but nothing about expiry firing.
 *     Expiry is handled PULL-side: a read-model endpoint
 *     GET /v1/contract/contracts/expiring plus renewal-notice DATE computation
 *     (modules/renewals). There is no scheduler/sweeper that enqueues an event.
 *  2. notification-service subscribes to NO contract.* topic
 *     (CONSUMED_EVENTS has hrms/finance/procurement/helpdesk/citizen/audit/ml/
 *     visitor — no contract).
 *
 * VERDICT: ORPHANED — contract expiry never reaches notification as an event.
 */
import { describe, it, expect, vi } from "vitest";
import { RecordingQueue } from "./_helpers.js";
import { EVENTS as CONTRACT_EVENTS, COMMANDS as CONTRACT_COMMANDS } from "../../services/contract-service/src/topics.js";
import { CONSUMED_EVENTS as NOTIF_CONSUMED } from "../../services/notification-service/src/topics.js";

// notification-service (would-be consumer) data layer
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

describe("FLOW 4 — Contract expiry → Alert (ORPHANED)", () => {
  it("(A) EMIT: contract-service defines NO expiry/expiring alert event", () => {
    const topics = [...Object.values(CONTRACT_EVENTS), ...Object.values(CONTRACT_COMMANDS)] as string[];
    const expiryEmitters = topics.filter((t) => /expir/i.test(t));
    expect(expiryEmitters).toEqual([]);
  });

  it("(B) CONSUME: notification subscribes to NO contract.* topic", () => {
    const rq = new RecordingQueue();
    registerDomainEventConsumers(rq.asQueue());
    const contractSubs = [...rq.subscribedTopics].filter((t) => t.startsWith("contract."));
    expect(contractSubs).toEqual([]);
    // Corroborate against the declared consumed-events map too.
    const consumed = Object.values(NOTIF_CONSUMED) as string[];
    expect(consumed.some((t) => t.startsWith("contract."))).toBe(false);
  });
});
