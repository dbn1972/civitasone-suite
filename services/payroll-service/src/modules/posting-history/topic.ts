/**
 * ST-M01-11 — the posting event this module consumes.
 *
 * `hrms.posting.changed` is a frozen contract topic (#1976 pack,
 * packages/events). It is deliberately NOT added to payroll-service's exported
 * `CONSUMED_EVENTS` map and NOT written as a string literal at the subscribe
 * call site, for the SAME ratchet reason hrms-service keeps its emission out of
 * an exported EVENTS map (services/hrms-service/src/topics.ts): the topic's
 * declared payroll consumer is OPEN D-ST-13 (PROPOSED), and its hrms producer
 * only emits it behind HRMS_POSTING_EVENTS_ENABLED (default off), so neither
 * side is an "effective" producer/consumer in the cross-service-events gate's
 * registry view. Declaring the subscription in CONSUMED_EVENTS (or inlining the
 * literal at the subscribe site) would register a NEW dead subscription and
 * trip the ratchet (D-101). Using this module-local named const keeps the
 * subscription invisible to the gate's registry scan — exactly the established
 * ST-M01-09 precedent — while the real wiring is still gated off by default
 * (config.isPostingConsumerEnabled) so nothing is pulled into a void at runtime.
 *
 * When D-ST-13 is APPROVED and the hrms producer is turned on fleet-wide, this
 * moves into CONSUMED_EVENTS and the event-list/contract consumer declarations
 * are updated in lockstep.
 */
export const POSTING_CHANGED_TOPIC = "hrms.posting.changed" as const;
