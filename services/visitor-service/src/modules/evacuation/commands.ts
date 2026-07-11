/**
 * visitor-service: evacuation command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 *
 * `evacuationDeclare` — publishes the evacuation-declare command so the
 * consumer can bulk-SMS all currently checked-in visitors via the
 * evacuation roster (Requirement 17.4).
 *
 * `evacuationMarkSafe` — publishes the mark-safe command for a specific
 * visitor (passId) so the consumer can update the roster entry's
 * `evacuated` flag and track completion percentage (Requirement 17.5).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export interface EvacuationDeclareInput {
  locationId: string;
  reason?: string | null;
}

/**
 * Declare an evacuation for a location. The consumer will:
 * 1. Fetch the full roster via `getFullRoster`
 * 2. Enqueue a `NOTIFICATION_SEND` bulk SMS to every roster contact
 * 3. Outbox `evacuationDeclared` event
 *
 * Requirement 17.4.
 */
export async function evacuationDeclare(ctx: RequestContext, input: EvacuationDeclareInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.evacuationDeclare, {
    messageId: id,
    type: COMMANDS.evacuationDeclare,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      locationId: input.locationId,
      reason: input.reason ?? null,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface EvacuationMarkSafeInput {
  locationId: string;
  passId: string;
}

/**
 * Mark a single visitor (by passId) as safely evacuated. The consumer will:
 * 1. Update the roster entry's `evacuated` flag to true
 * 2. Compute completion percentage (evacuated / total)
 * 3. If 100% → outbox `evacuationCompleted` event
 *
 * Requirement 17.5.
 */
export async function evacuationMarkSafe(ctx: RequestContext, input: EvacuationMarkSafeInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.evacuationMarkSafe, {
    messageId,
    type: COMMANDS.evacuationMarkSafe,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      tenantId: ctx.tenantId,
      locationId: input.locationId,
      passId: input.passId,
    },
  });
  return { id: input.passId, status: "accepted", correlationId: ctx.correlationId };
}
