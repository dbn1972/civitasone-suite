/**
 * PERF-008 — per-topic outbox schema-version registry.
 *
 * Before this file, `packages/outbox/src/index.ts`'s relay hardcoded
 * `schemaVersion: "1.0"` at the single call site that publishes every outbox
 * row, for every topic, fleet-wide — there was no way for one topic's payload
 * to evolve independently of another's. This file is the real per-topic
 * mechanism: a topic's CURRENT version is looked up here, not baked into the
 * publish call.
 *
 * There is deliberately no entry for most (currently: any) topic below. That
 * is the honest, accurate state of this fleet today — no topic's payload has
 * ever diverged from the original "1.0" shape, so every topic legitimately
 * resolves to DEFAULT_SCHEMA_VERSION. Adding entries here is a project for
 * whichever team first makes a breaking-relevant change to a topic's payload;
 * it is not backfilled speculatively by this change. What's new and real is
 * the CAPABILITY — a topic-keyed lookup instead of one shared literal — not a
 * claim that today's versions already differ from each other.
 *
 * When a topic's payload changes in a way consumers should know about (see
 * packages/events/src/schema-registry.ts's own header for what counts as
 * breaking vs. additive — that registry validates payload shape at
 * publish/consume boundaries; this file only tracks the version LABEL a topic
 * is currently on, a narrower, deliberately simpler concern), bump its entry
 * here:
 *
 *   const TOPIC_SCHEMA_VERSIONS: Record<string, string> = {
 *     "tenant.tenant.updated": "1.1",
 *   };
 *
 * Every caller of outbox's `enqueue()` picks this up automatically (it
 * resolves the topic's version at enqueue time unless the caller passes an
 * explicit `schemaVersion`) — no per-call-site changes needed when a topic's
 * version moves.
 */

/** The version every topic is on until this file says otherwise. */
export const DEFAULT_SCHEMA_VERSION = "1.0";

const TOPIC_SCHEMA_VERSIONS: Record<string, string> = {
  // (intentionally empty — see file header)
};

/** Resolve a topic's current schema version. Unlisted topics get the default. */
export function getTopicSchemaVersion(topic: string): string {
  return TOPIC_SCHEMA_VERSIONS[topic] ?? DEFAULT_SCHEMA_VERSION;
}
