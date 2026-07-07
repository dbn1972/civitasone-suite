import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateDocumentBody, UpdateDocumentBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createDocument(ctx: RequestContext, body: CreateDocumentBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.documentCreate, {
    messageId: id,
    type: COMMANDS.documentCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDocument(ctx: RequestContext, documentId: string, body: UpdateDocumentBody): Promise<Accepted> {
  await queue.publish(COMMANDS.documentUpdate, {
    messageId: randomUUID(),
    type: COMMANDS.documentUpdate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, documentId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "document", documentId));
  return { id: documentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDocument(ctx: RequestContext, documentId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.documentDelete, {
    messageId: randomUUID(),
    type: COMMANDS.documentDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { documentId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "document", documentId));
  return { id: documentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function applyLegalHold(ctx: RequestContext, documentId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.documentHoldApply, {
    messageId: randomUUID(),
    type: COMMANDS.documentHoldApply,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { documentId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "document", documentId));
  return { id: documentId, status: "accepted", correlationId: ctx.correlationId };
}

export async function releaseLegalHold(ctx: RequestContext, documentId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.documentHoldRelease, {
    messageId: randomUUID(),
    type: COMMANDS.documentHoldRelease,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { documentId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "document", documentId));
  return { id: documentId, status: "accepted", correlationId: ctx.correlationId };
}
