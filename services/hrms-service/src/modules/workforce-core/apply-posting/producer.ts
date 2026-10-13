/**
 * applyPosting — scoped service credential for the SmartTransfer→HRMS command
 * path (SmartTransfer OS, ST-M01-15). Spec §14 (least-privilege service
 * accounts, no cross-service writes). D-ST-10 (APPROVED — SmartTransfer may act
 * on a posting ONLY through this command), D-ST-04, D-ST-19 (APPROVED — every
 * `hrms.posting.*` topic ships a `defineContract`; the contract's `owner` is
 * the single service allowed to PUBLISH the topic).
 *
 * WHAT THIS IS. A consumer-side check of the PRODUCING service carried in the
 * command envelope, enforcing the frozen contract's producer ACL at the point
 * the write happens. It is the narrowest mechanism that already exists in this
 * repo:
 *   - the `defineContract` DSL already declares `owner` as "the only service
 *     allowed to publish this topic" (packages/events/src/contracts/define.ts),
 *     and `hrms.posting.apply`'s owner is `smarttransfer-service`
 *     (packages/events/src/contracts/smarttransfer/hrms-posting-topics.ts); and
 *   - producers across the repo already stamp their identity into the payload
 *     as `sourceService` (the municipal cross-events convention, e.g.
 *     services/building-service/src/shared/cross-events.ts:50 —
 *     `sourceService: SERVICE`), which downstream code reads and asserts.
 * We reuse BOTH: the command payload carries a `producer` field (same shape as
 * `sourceService`), and this guard refuses any producer that is not on the
 * allow-list derived from the frozen contract.
 *
 * WHY A PAYLOAD FIELD, NOT A NEW ENVELOPE FIELD. `CommandEnvelope`
 * (services/queue-service/src/bus.ts) is the wire contract shared by 66
 * services; adding a field there is out of scope and risky. The `sourceService`
 * payload convention is the established, additive, tolerant-reader shape
 * (contracts use `.passthrough()`, so adding `producer` to the published
 * payload does NOT change the frozen `hrms.posting.apply` schema — D-18).
 *
 * TRUST MODEL (honest). This is DEFENCE IN DEPTH enforcing the DECLARED
 * producer ACL. The payload field is as trustworthy as the queue it rides on:
 * the platform's transport trust boundary (broker credentials, network policy)
 * is what stops an unauthenticated writer from reaching the bus at all — the
 * repo has no per-topic transport ACL today. What this guard DOES guarantee is
 * that even a legitimately-connected but WRONG service (e.g. payroll-service, a
 * rogue leave consumer, or a mis-wired future producer) cannot drive a posting
 * write through this consumer: the write is refused with an AUDITED record and
 * the raw reason is never leaked (house rule 6). The producing service's label
 * is also authenticated end-to-end wherever the HTTP affordance is used, via
 * the existing `x-internal` + `INTERNAL_SERVICE_SECRET` service path
 * (packages/auth/src/plugin.ts) — no secret-shaped literal is introduced here.
 */
import { getContract } from "@civitasone/events";

/**
 * The topic whose producer ACL we enforce. The command the applyPosting
 * consumer subscribes to (COMMANDS.postingApply === "hrms.posting.apply").
 */
export const APPLY_POSTING_TOPIC = "hrms.posting.apply" as const;

/**
 * The hrms-service in-service HTTP affordance
 * (apply-posting/routes.ts → commands.ts) drives the SAME posting path a human
 * HR admin uses in a standalone Workforce Core deployment. It runs inside
 * hrms-service itself and is authorised by `requireRole(["hr_admin",
 * "super_admin"])` at the route, so it is a trusted self-producer.
 */
export const IN_SERVICE_PRODUCER = "hrms-service" as const;

/**
 * The frozen contract owner for `hrms.posting.apply` — the ONLY cross-service
 * publisher the contract permits (D-ST-19). Read from the registered contract
 * so the ACL cannot drift from the frozen definition; falls back to the known
 * owner literal if the contract pack has not been imported in a given context
 * (the pack is imported transitively through @civitasone/events).
 */
export function contractOwner(): string {
  return getContract(APPLY_POSTING_TOPIC)?.owner ?? "smarttransfer-service";
}

/**
 * The producers allowed to drive the applyPosting write: the frozen contract
 * owner (SmartTransfer, cross-service) and the hrms-service in-service HTTP
 * affordance (self). Any other producer is refused.
 */
export function allowedProducers(): ReadonlySet<string> {
  return new Set<string>([contractOwner(), IN_SERVICE_PRODUCER]);
}

/**
 * True when `producer` is an authorised publisher of the posting-apply command.
 * A missing/blank producer is NOT allowed (fail closed): every legitimate
 * publisher stamps its identity.
 */
export function isAllowedProducer(producer: unknown): boolean {
  return typeof producer === "string" && allowedProducers().has(producer);
}
