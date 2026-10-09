/**
 * ST-M01-06 — shared fragments for the SmartTransfer / Workforce Core contract
 * pack (spec §11 module integration, §19; D-ST-19, D-ST-10, D-18).
 *
 * Every `smarttransfer.*` and `hrms.posting.*` topic ships a `defineContract`
 * in mode **enforce** (D-ST-19, APPROVED). The topic surface is frozen by the
 * event list in PR #1974 (ST-M01-05, `docs/smarttransfer/event-list.md`) and
 * must be kept in lockstep with it: that doc is the single source of the topic
 * names, kinds, owners and payload outlines; this file does not duplicate it,
 * it realises it as code.
 *
 * House rules honoured here:
 *   - every payload carries a `tenantId` (invariant I5: payload tenant ==
 *     envelope tenant, enforced by the consumer gate because `hasTenantId`);
 *   - no C0 topic carries money, so no `*Minor` field appears; if one is added
 *     later it is a wire STRING ending in `Minor` with a required `currency`
 *     from schema v2 (D-18 / house rule 4) — never a bare number;
 *   - sensitive attributes (category, disability, medical, spouse) never appear
 *     in an event payload; they stay in the frozen snapshot (M00 §8.2), so the
 *     `pii` list below is empty for every C0 contract (declared explicitly, as
 *     DPDP erasure feeds off it).
 */
import { z, type ZodObject, type ZodRawShape } from "zod";
import { defineContract, type Contract, type ContractKind } from "../define.js";

/** Queue truncation ceiling: `bus.ts` `TOPIC_BASE_MAX`, dot-to-dash form. */
export const TOPIC_BASE_MAX = 45;

/**
 * The dash form of a topic (dots → dashes) as `services/queue-service/src/bus.ts`
 * `topicBaseName` computes it before truncating to {@link TOPIC_BASE_MAX}. A
 * topic whose dash form is longer would be truncated and could collide with
 * another topic's per-service queue, so every contract asserts this length (see
 * the contract tests).
 */
export function topicDashForm(topic: string): string {
  return topic.replace(/\./g, "-");
}

/** A tenant id is always present (I5) and is a non-empty string. */
export const zTenantId = z.string().min(1);

/** An opaque identifier (uuid / ULID) carried on the wire as a string. */
export const zId = z.string().min(1);

/** An ISO-8601 instant or date carried as a string. */
export const zWhen = z.string().min(1);

/** A short machine code (reason / ground / outcome etc.). */
export const zCode = z.string().min(1);

/**
 * Define a SmartTransfer / Workforce Core contract. It pins `mode: "enforce"`
 * (D-ST-19 — the DSL default of `"off"` is NOT acceptable for these topics) and
 * `visibility: "internal"`, so a caller cannot forget the enforce requirement.
 * The global `EVENT_CONTRACT_MODE` kill switch and the per-tenant
 * `EVENT_CONTRACT_ENFORCE_TENANTS` allow-list still gate whether enforcement
 * actually fires at runtime (modes.ts); `enforce` is the contract's *ceiling*,
 * not a platform-wide behaviour change, so no change to modes.ts is required.
 */
export function defineStContract<Shape extends ZodRawShape>(input: {
  topic: string;
  kind: ContractKind;
  owner: string;
  version: string;
  schema: ZodObject<Shape>;
  consumers: string[];
  /** PII paths; `[]` for every C0 contract, declared explicitly (DPDP). */
  pii?: string[];
}): Contract<Shape> {
  return defineContract({
    topic: input.topic,
    kind: input.kind,
    owner: input.owner,
    version: input.version,
    schema: input.schema,
    pii: input.pii ?? [],
    visibility: "internal",
    consumers: input.consumers,
    mode: "enforce",
  });
}

export { z };
