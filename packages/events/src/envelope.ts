/**
 * Runtime validation for the canonical command/event envelope.
 *
 * The compile-time `EventEnvelope<T>` type (see index.ts) and the runtime
 * `CommandEnvelope` shape used by the message bus (services/queue-service)
 * share the same wire contract. This module is the single runtime guard that
 * consumers can use at the consume boundary instead of casting with `as`.
 */
import { z } from "zod";

// Envelope field contract — mirrors CommandEnvelope in queue-service/src/bus.ts.
// schemaVersion must be present and non-empty (04-T3): an absent/blank version
// makes the envelope un-routable and is treated as invalid.
export const eventEnvelopeSchema = z.object({
  messageId: z.string().uuid(),
  type: z.string().min(1),
  tenantId: z.string().min(1),
  actorId: z.string().min(1),
  correlationId: z.string().min(1),
  causationId: z.string().min(1).optional(),
  timestamp: z.string().min(1),
  schemaVersion: z.string().min(1),
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
