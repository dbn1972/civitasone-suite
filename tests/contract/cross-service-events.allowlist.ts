import { NO_CONSUMER_BY_DESIGN, NO_CONSUMER_CATEGORY, NO_CONSUMER_DECISION_REF } from "./cross-service-events.no-consumer.js";

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
 *  - NO CONSUMER BY DESIGN (audit/status): fire-and-forget audit/status facts,
 *    approved by owner decision 2026-10-07 (PR #1929); see
 *    cross-service-events.no-consumer.ts. Needs a date, a purpose and the decision
 *    reference. NOT for events with an expected downstream effect.
 */
export const PRODUCER_ONLY_ALLOWLIST: Record<string, string> = {
  ...NO_CONSUMER_BY_DESIGN,
  "project.dpr.transitioned": `${NO_CONSUMER_CATEGORY} — 2026-10-07 — dpr transitioned audit/status fact in the project lifecycle history; no business consumer expected — ${NO_CONSUMER_DECISION_REF}`,
  "project.escalation.actioned": `${NO_CONSUMER_CATEGORY} — 2026-10-07 — escalation actioned audit/status fact in the project lifecycle history; no business consumer expected — ${NO_CONSUMER_DECISION_REF}`,
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
  const CATEGORIES = ["INFRASTRUCTURE SINK", "EXTERNAL CONSUMER", "EXTERNAL DELIVERY", "EXTERNAL PRODUCER", "PLANNED", NO_CONSUMER_CATEGORY];
  const check = (name: string, rec: Record<string, string>): void => {
    for (const [topic, reason] of Object.entries(rec)) {
      if (!reason || reason.trim().length < 20) {
        errs.push(`${name}["${topic}"] has no substantive reason`);
      } else if (!CATEGORIES.some((c) => reason.startsWith(c))) {
        errs.push(`${name}["${topic}"] reason must start with one of: ${CATEGORIES.join(" | ")}`);
      } else if (reason.startsWith(NO_CONSUMER_CATEGORY)) {
        const parts = reason.split(" — ").map((x) => x.trim());
        const date = parts[1] ?? "";
        const purpose = parts[2] ?? "";
        const ref = parts.slice(3).join(" — ");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          errs.push(`${name}["${topic}"] NO CONSUMER entry needs an ISO date as its second segment`);
        }
        if (purpose.length < 25 || !/audit|status|history|record|notification/i.test(purpose)) {
          errs.push(`${name}["${topic}"] NO CONSUMER entry must name the audit/status purpose of the event (>=25 chars)`);
        }
        // The purpose must be specific to THIS event: it has to name the event (everything
        // after the service prefix, underscores as spaces), so one generic template cannot
        // be pasted across entries.
        const named = topic.split(".").slice(1).join(" ").replace(/_/g, " ").toLowerCase();
        if (!purpose.toLowerCase().includes(named)) {
          errs.push(`${name}["${topic}"] NO CONSUMER purpose must name the event ("${named}")`);
        }
        if (!ref.includes(NO_CONSUMER_DECISION_REF)) {
          errs.push(`${name}["${topic}"] NO CONSUMER entry must cite "${NO_CONSUMER_DECISION_REF}"`);
        }
      }
    }
  };
  check("PRODUCER_ONLY_ALLOWLIST", PRODUCER_ONLY_ALLOWLIST);
  check("CONSUMER_ONLY_ALLOWLIST", CONSUMER_ONLY_ALLOWLIST);
  check("PRODUCER_ONLY_PREFIX_ALLOWLIST", PRODUCER_ONLY_PREFIX_ALLOWLIST);
  return errs;
}
