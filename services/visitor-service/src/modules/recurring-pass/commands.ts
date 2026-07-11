/**
 * visitor-service: recurring-pass command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern, per
 * structure.md). Each function mints the entity's `id` (uuid) BEFORE
 * publishing and returns it as part of the 202 Accepted response so the
 * caller knows the eventual row ID immediately.
 *
 * Requirement 12.4: suspend/revoke commands are processed by the consumer
 * within the same SQS batch, meaning the Redis revocation-set update is
 * effective within seconds (≤30s at all gate terminals).
 *
 * No routes.ts exists yet for this module (Task 13.5) — these publishers
 * are the seam routes.ts will call once it is scaffolded.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── Create ────────────────────────────────────────────────────────────────

export interface RecurringPassCreateInput {
  locationId: string;
  visitorName: string;
  visitorPhone: string;
  companyName?: string | null;
  validFrom: string; // ISO timestamp
  validUntil: string; // ISO timestamp
  permittedDays: number[]; // 0=Sun..6=Sat
  permittedTimeFrom?: string | null; // "HH:MM"
  permittedTimeTo?: string | null; // "HH:MM"
}

/**
 * Publishes a `recurringPassCreate` command (Requirement 12.1). The
 * consumer persists the pass and issues a digital pass QR after approval.
 */
export async function recurringPassCreate(ctx: RequestContext, input: RecurringPassCreateInput): Promise<Accepted> {
  const id = randomUUID();
  const passId = randomUUID();
  await queue.publish(COMMANDS.recurringPassCreate, {
    messageId: id,
    type: COMMANDS.recurringPassCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      passId,
      tenantId: ctx.tenantId,
      locationId: input.locationId,
      visitorName: input.visitorName,
      visitorPhone: input.visitorPhone,
      companyName: input.companyName ?? null,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      permittedDays: input.permittedDays,
      permittedTimeFrom: input.permittedTimeFrom ?? null,
      permittedTimeTo: input.permittedTimeTo ?? null,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

// ── Suspend ───────────────────────────────────────────────────────────────

export interface RecurringPassSuspendInput {
  passId: string;
  reason: string;
}

/**
 * Publishes a `recurringPassSuspend` command (Requirement 12.4). The
 * consumer transitions the pass to `suspended`, adds it to the Redis
 * revocation set (effective within 30s at all gate terminals), and notifies
 * the pass holder and issuing manager.
 */
export async function recurringPassSuspend(ctx: RequestContext, input: RecurringPassSuspendInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.recurringPassSuspend, {
    messageId,
    type: COMMANDS.recurringPassSuspend,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id: input.passId,
      tenantId: ctx.tenantId,
      reason: input.reason,
    },
  });
  return { id: input.passId, status: "accepted", correlationId: ctx.correlationId };
}

// ── Revoke ────────────────────────────────────────────────────────────────

export interface RecurringPassRevokeInput {
  passId: string;
  reason?: string | null;
}

/**
 * Publishes a `recurringPassRevoke` command (Requirement 12.4). The
 * consumer transitions the pass to `revoked`, adds it to the Redis
 * revocation set (effective within 30s at all gate terminals), and notifies
 * the pass holder and issuing manager (Requirement 12.5).
 */
export async function recurringPassRevoke(ctx: RequestContext, input: RecurringPassRevokeInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.recurringPassRevoke, {
    messageId,
    type: COMMANDS.recurringPassRevoke,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id: input.passId,
      tenantId: ctx.tenantId,
      reason: input.reason ?? null,
    },
  });
  return { id: input.passId, status: "accepted", correlationId: ctx.correlationId };
}
