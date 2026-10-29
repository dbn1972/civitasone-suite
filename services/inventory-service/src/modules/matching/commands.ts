/**
 * Command handlers (WRITE PATH) — validate, publish command, return accepted.
 * The consumer is the only code that writes Postgres.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateMatchBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

// `messageId` is the idempotency key the consumer's markProcessed() dedups on. It defaults to the
// entity id (fine for a create, whose id is fresh), but a follow-up command on an existing entity
// MUST pass a per-command id: reusing the entity id collides with the create's inbox row and the
// command is silently dropped (202, nothing happens).
async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>, messageId: string = id): Promise<void> {
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

export async function createMatch(ctx: RequestContext, body: CreateMatchBody): Promise<Accepted> {
  const id = randomUUID();
  await publish(COMMANDS.threeWayMatchCreate, ctx, id, {
    id,
    tenantId: ctx.tenantId,
    poId: body.poId,
    poLineId: body.poLineId,
    grnId: body.grnId,
    invoiceId: body.invoiceId,
    poQty: body.poQty,
    poRatePaise: String(body.poRatePaise),
    grnQty: body.grnQty,
    invoiceQty: body.invoiceQty,
    invoiceRatePaise: String(body.invoiceRatePaise),
    tolerancePct: body.tolerancePct,
    toleranceAbsPaise: body.toleranceAbsPaise ? String(body.toleranceAbsPaise) : undefined,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function resolveMatch(ctx: RequestContext, id: string, version: number, resolutionNote: string): Promise<Accepted> {
  await publish(COMMANDS.threeWayMatchResolve, ctx, id, { id, tenantId: ctx.tenantId, version, resolutionNote }, randomUUID());
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
