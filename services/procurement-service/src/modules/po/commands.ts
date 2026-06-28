import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreatePoBody, GemOrderBody, DispatchBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPo(ctx: RequestContext, body: CreatePoBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.poCreate, {
    messageId: id, type: COMMANDS.poCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function dispatchPo(ctx: RequestContext, id: string, body: DispatchBody): Promise<Accepted> {
  await queue.publish(COMMANDS.poDispatch, {
    type: COMMANDS.poDispatch,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createGemOrder(ctx: RequestContext, body: GemOrderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.gemOrderCreate, {
    messageId: id, type: COMMANDS.gemOrderCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Submit a PO to eOffice for administrative approval. The eFile is raised via
 * the eOffice integration; once the file is decided, the
 * `procurement.po.file_decided` callback (see eoffice-consumer) moves the PO to
 * approved/cancelled. This transition makes the source state honest while the
 * file is under approval.
 */
export async function submitPoForApproval(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.poSubmitApproval, {
    type: COMMANDS.poSubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "po", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
