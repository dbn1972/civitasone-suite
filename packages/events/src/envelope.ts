/**
 * Runtime validation for the canonical command/event envelope.
 *
 * The compile-time `EventEnvelope<T>` type (see index.ts) and the runtime
 * `CommandEnvelope` shape used by the message bus (services/queue-service)
 * share the same wire contract. This module is the single runtime guard that
 * consumers can use at the consume boundary instead of casting with `as`.
 */
import { z } from "zod";

// PERF-008: W3C Trace Context header shape, e.g.
// "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01". See bus.ts's
// deriveTraceparent() for how this repo populates it (no live OTel SDK
// installed anywhere here today — this validates the HEADER FORMAT, not a
// claim that a real span produced it).
const TRACEPARENT_RE = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

// Envelope field contract — mirrors CommandEnvelope in queue-service/src/bus.ts.
// schemaVersion must be present and non-empty (04-T3): an absent/blank version
// makes the envelope un-routable and is treated as invalid.
//
// traceparent (PERF-008) is deliberately OPTIONAL here, unlike schemaVersion,
// even though every publish path in this repo now always sets it: at the
// moment this validation first deploys, real queues (SQS/RabbitMQ) can still
// hold in-flight messages published by the previous version of this code,
// which never wrote a traceparent at all. Requiring it here would dead-letter
// every one of those perfectly good in-flight messages during the rollout
// window — a self-inflicted incident for a field that only exists to help
// correlate logs. Validating its FORMAT when present (so a corrupt value is
// still caught) without requiring its PRESENCE is the safe rollout shape for
// a brand-new field on a live system; schemaVersion doesn't have this problem
// because it predates this change by a long way.
export const eventEnvelopeSchema = z.object({
  messageId: z.string().uuid(),
  type: z.string().min(1),
  tenantId: z.string().min(1),
  actorId: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  timestamp: z.string().min(1),
  schemaVersion: z.string().min(1),
  traceparent: z.string().regex(TRACEPARENT_RE, "traceparent must be a valid W3C Trace Context header").optional(),
  payload: z.unknown(),
});

export type ValidatedEnvelope = z.infer<typeof eventEnvelopeSchema>;

export type ParseEnvelopeResult =
  | { ok: true; value: ValidatedEnvelope }
  | { ok: false; error: string };

/**
 * Safe, non-throwing envelope parse. Returns a discriminated result so callers
 * can branch without try/catch.
 */
export function parseEnvelope(raw: unknown): ParseEnvelopeResult {
  const result = eventEnvelopeSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, value: result.data };
  }
  return { ok: false, error: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
