/**
 * Command handlers (WRITE PATH) — validate, publish command, return accepted.
 * The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateCycleCountBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * `messageId` is the transport-level idempotency key (`_inbox.processed.message_id`
 * is its sole, globally-unique primary key — see @civitasone/outbox's
 * markProcessed) and MUST be unique per published message, never reused
 * across a domain entity's lifecycle. It is a DIFFERENT value from the
 * entity's own `id`, which legitimately stays the same across create/approve/
 * reject and is carried inside `payload` instead.
 *
 * BUG FOUND WHILE FIXING THIS MODULE (beyond the 3 originally scoped): every
 * call below used to pass the entity id as BOTH the third positional
 * argument (this function's `messageId`) AND inside `payload.id`. That is
 * harmless for createCycleCount (a fresh randomUUID makes both values equal
 * but still unique), but approveCycleCount/rejectCycleCount were called with
 * the route's `:id` param — the cycle count's EXISTING id, i.e. the SAME
 * value create's message already used as ITS messageId. Since
 * `_inbox.processed` already had a row for that id (written when create's
 * handler ran), approve/reject's `markProcessed(tx, msg.messageId)` — the
 * first line of both handlers — always found it already present and bailed
 * out immediately, before the version-gated UPDATE ever ran. Approve/reject
 * would silently no-op forever, independent of (and masked by, until fixed)
 * the CHECK-constraint bug that already blocked every create. Confirmed by
 * reading @civitasone/outbox's `processed` table definition (message_id
 * uuid PRIMARY KEY, no topic/tenant component) and reproduced live (see
 * tests/cycle-count-lifecycle.integration.test.ts). Same-shaped bug is
 * still present in this service's `matching` module (matching/commands.ts) —
 * out of scope here, flagged separately.
 */
async function publish(type: string, ctx: RequestContext, messageId: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId,
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  });
}

export async function createCycleCount(ctx: RequestContext, body: CreateCycleCountBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.cycleCountCreate, ctx, id, { id, tenantId: ctx.tenantId, ...body });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveCycleCount(ctx: RequestContext, id: string, version: number): Promise<Accepted> {
  // Fresh messageId per command (see publish()'s doc comment) — `id` (the
  // cycle count being approved) travels in the payload instead.
  await publish(COMMANDS.cycleCountApprove, ctx, randomUUID(), { id, tenantId: ctx.tenantId, version });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectCycleCount(ctx: RequestContext, id: string, version: number, reason: string): Promise<Accepted> {
  // Fresh messageId per command (see publish()'s doc comment) — `id` (the
  // cycle count being rejected) travels in the payload instead.
  await publish(COMMANDS.cycleCountReject, ctx, randomUUID(), { id, tenantId: ctx.tenantId, version, reason });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
