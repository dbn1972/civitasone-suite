import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateHearingBody, AdjournBody, RecordOrderBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createHearing(ctx: RequestContext, caseId: string, body: CreateHearingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.hearingCreate, {
    messageId: id, type: COMMANDS.hearingCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, caseId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "case", caseId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function adjournHearing(ctx: RequestContext, caseId: string, hearingId: string, body: AdjournBody): Promise<Accepted> {
  await queue.publish(COMMANDS.hearingAdjourn, {
    type: COMMANDS.hearingAdjourn,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { caseId, hearingId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "case", caseId));
  return { id: hearingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function recordOrder(ctx: RequestContext, caseId: string, body: RecordOrderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.orderRecord, {
    messageId: id, type: COMMANDS.orderRecord,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, caseId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "case", caseId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
