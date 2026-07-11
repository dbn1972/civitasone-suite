/**
 * visitor-service: digital-pass command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 * Each function mints the entity ID (uuid) BEFORE publishing and returns it
 * as the 202 Accepted `id` — the consumer MUST insert with that exact `id`
 * so the id returned to the client matches the eventually-persisted row.
 *
 * `passGenerate` is also invoked internally by the visit-request consumer
 * (Task 6.11) when a visit request is approved — it publishes a
 * `visitor.pass.generate` command so the digital-pass consumer picks up the
 * generation asynchronously.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── passGenerate ──────────────────────────────────────────────────────────

export interface PassGenerateInput {
  visitRequestId: string;
  visitorId: string;
  locationId: string;
  passType: "single" | "multi_day" | "recurring" | "event";
  validFrom: string; // ISO timestamp
  validUntil: string; // ISO timestamp
  permittedAreas: string[];
  tenantPrivateKeyPem: string; // RS256 PKCS8 PEM for QR signing
  escortEmployeeId?: string | null;
}

/**
 * Publishes a `visitor.pass.generate` command (Requirement 4.2).
 * Called by `modules/visit-request/consumer.ts` on approval, or directly
 * by routes if ever exposed as a manual action.
 */
export async function passGenerate(ctx: RequestContext, input: PassGenerateInput): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.passGenerate, {
    messageId: id,
    type: COMMANDS.passGenerate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      visitRequestId: input.visitRequestId,
      visitorId: input.visitorId,
      locationId: input.locationId,
      passType: input.passType,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      permittedAreas: input.permittedAreas,
      tenantPrivateKeyPem: input.tenantPrivateKeyPem,
      escortEmployeeId: input.escortEmployeeId ?? null,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ── passRevoke ────────────────────────────────────────────────────────────

export interface PassRevokeInput {
  passId: string;
  reason: string;
}

/**
 * Publishes a `visitor.pass.revoke` command (Requirement 4.5).
 * The consumer adds the pass to the Redis revocation set and outboxes
 * `passRevoked`.
 */
export async function passRevoke(ctx: RequestContext, input: PassRevokeInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.passRevoke, {
    messageId,
    type: COMMANDS.passRevoke,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { passId: input.passId, reason: input.reason, tenantId: ctx.tenantId },
  });
  return { id: input.passId, status: "accepted", correlationId: ctx.correlationId };
}

// ── passReplace ───────────────────────────────────────────────────────────

export interface PassReplaceInput {
  passId: string;
  reason: string;
  tenantPrivateKeyPem: string; // RS256 PKCS8 PEM for new QR signing
}

/**
 * Publishes a `visitor.pass.replace` command (Requirement 4.5).
 * The consumer revokes the existing pass, generates a new replacement pass,
 * sets `replacedById` on the original, and outboxes `passReplaced`.
 */
export async function passReplace(ctx: RequestContext, input: PassReplaceInput): Promise<Accepted> {
  const newPassId = randomUUID();
  await queue.publish(COMMANDS.passReplace, {
    messageId: newPassId,
    type: COMMANDS.passReplace,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      originalPassId: input.passId,
      newPassId,
      reason: input.reason,
      tenantId: ctx.tenantId,
      tenantPrivateKeyPem: input.tenantPrivateKeyPem,
    },
  });
  return { id: newPassId, status: "accepted", correlationId: ctx.correlationId };
}
