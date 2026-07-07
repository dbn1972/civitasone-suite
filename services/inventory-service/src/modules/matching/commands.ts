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

async function publish(type: string, ctx: RequestContext, id: string, payload: Record<string, unknown>): Promise<void> {
  await queue.publish(type, {
    messageId: id,
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
  await publish(COMMANDS.threeWayMatchResolve, ctx, id, { id, tenantId: ctx.tenantId, version, resolutionNote });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
