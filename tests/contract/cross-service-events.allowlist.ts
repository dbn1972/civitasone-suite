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
  // NOTE: `audit.event.record` was previously listed here on the stated grounds
  // that audit-service had "no per-topic CONSUMED_EVENTS declaration". That was
  // factually wrong — audit-service declared it in a map named CONSUME_TOPICS,
  // which the gate's name list did not recognise, so the contract was invisible
  // and the allowlist was papering over a parser gap. The map has been renamed
  // to CONSUMED_EVENTS and the entry removed. Do not re-add allowlist entries to
  // work around extractor limitations — fix the extractor.
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

// `Object.hasOwn` rather than bare index access: a topic literally named
// "constructor" or "toString" would otherwise resolve to a prototype member and
// be silently treated as allowlisted.
export function isProducerOnlyAllowed(topic: string): string | null {
  if (Object.hasOwn(PRODUCER_ONLY_ALLOWLIST, topic)) {
    return PRODUCER_ONLY_ALLOWLIST[topic] ?? null;
  }
  for (const [prefix, reason] of Object.entries(PRODUCER_ONLY_PREFIX_ALLOWLIST)) {
    if (topic.startsWith(prefix)) return reason;
  }
  return null;
}

export function isConsumerOnlyAllowed(topic: string): string | null {
  if (!Object.hasOwn(CONSUMER_ONLY_ALLOWLIST, topic)) return null;
  return CONSUMER_ONLY_ALLOWLIST[topic] ?? null;
}

/** Every allowlist entry must carry a non-empty, categorised reason. */
export function allowlistIntegrityErrors(): string[] {
  const errs: string[] = [];
  const CATEGORIES = ["INFRASTRUCTURE SINK", "EXTERNAL CONSUMER", "EXTERNAL DELIVERY", "EXTERNAL PRODUCER", "PLANNED"];
  const check = (name: string, rec: Record<string, string>): void => {
    for (const [topic, reason] of Object.entries(rec)) {
      if (!reason || reason.trim().length < 20) {
        errs.push(`${name}["${topic}"] has no substantive reason`);
      } else if (!CATEGORIES.some((c) => reason.startsWith(c))) {
        errs.push(`${name}["${topic}"] reason must start with one of: ${CATEGORIES.join(" | ")}`);
      }
    }
  };
  check("PRODUCER_ONLY_ALLOWLIST", PRODUCER_ONLY_ALLOWLIST);
  check("CONSUMER_ONLY_ALLOWLIST", CONSUMER_ONLY_ALLOWLIST);
  check("PRODUCER_ONLY_PREFIX_ALLOWLIST", PRODUCER_ONLY_PREFIX_ALLOWLIST);
  return errs;
}
