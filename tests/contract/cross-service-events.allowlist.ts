/**
 * Documented exceptions for the cross-service event contract gate.
 *
 * Adding an entry here is a DELIBERATE architectural statement, reviewed like
 * code. Every entry needs a reason — "it fails CI" is not a reason.
 */

/**
 * Topics that are legitimately produced with no in-repo consumer.
 *
 * Valid reasons only:
 *  - INFRASTRUCTURE SINK: consumed by a generic handler that subscribes
 *    dynamically (audit ingest), so no static CONSUMED_EVENTS entry exists.
 *  - EXTERNAL CONSUMER: consumed outside this repo (webhook, mobile push).
 */
export const PRODUCER_ONLY_ALLOWLIST: Record<string, string> = {
  "audit.event.record":
    "INFRASTRUCTURE SINK — audit-service ingests every service's audit event via a generic consumer, not a per-topic CONSUMED_EVENTS declaration.",
};

/**
 * Topics a service subscribes to that have no in-repo producer.
 *
 * Valid reasons only:
 *  - EXTERNAL PRODUCER: emitted by an external system into our queue
 *    (payment gateway callback, government rail webhook bridge).
 *  - PLANNED: producer lands in a tracked follow-up — MUST carry an issue ref.
 */
export const CONSUMER_ONLY_ALLOWLIST: Record<string, string> = {};

/**
 * Prefix-matched producer-only allowances, for whole families of events that are
 * fanned out to external subscribers (notification transport, webhooks).
 */
export const PRODUCER_ONLY_PREFIX_ALLOWLIST: Record<string, string> = {
  "notification.":
    "EXTERNAL DELIVERY — notification-service terminates these topics into email/SMS/push/webhook transports; there is no downstream in-repo consumer by design.",
};

export function isProducerOnlyAllowed(topic: string): string | null {
  if (PRODUCER_ONLY_ALLOWLIST[topic]) return PRODUCER_ONLY_ALLOWLIST[topic];
  for (const [prefix, reason] of Object.entries(PRODUCER_ONLY_PREFIX_ALLOWLIST)) {
    if (topic.startsWith(prefix)) return reason;
  }
  return null;
}

export function isConsumerOnlyAllowed(topic: string): string | null {
  return CONSUMER_ONLY_ALLOWLIST[topic] ?? null;
}
