import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateEsignRouteBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createEsignRoute(ctx: RequestContext, body: CreateEsignRouteBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.esignCreate, {
    messageId: id, type: COMMANDS.esignCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, contractId: body.contractId, ownerId: body.ownerId, signatories: body.signatories },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function signEsignRoute(ctx: RequestContext, id: string, userId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.esignSign, {
    messageId: randomUUID(), type: COMMANDS.esignSign,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, userId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "esign_route", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function checkEsignDeadline(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.esignCheckDeadline, {
    messageId: randomUUID(), type: COMMANDS.esignCheckDeadline,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "esign_route", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
