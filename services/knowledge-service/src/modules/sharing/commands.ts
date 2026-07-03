import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { DocumentShareView } from "./schema.js";
import type { CreateShareBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

const RESOURCE = "share";

export async function shareCreate(ctx: RequestContext, body: CreateShareBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: DocumentShareView = {
    id,
    tenantId: ctx.tenantId,
    documentId: body.documentId,
    sharedWith: body.sharedWith,
    permission: body.permission,
    expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: ctx.actorId,
    updatedBy: ctx.actorId,
    version: 1,
  };

  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.shareCreate, {
    messageId: id,
    type: COMMANDS.shareCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function shareRevoke(ctx: RequestContext, id: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.shareRevoke, {
    messageId,
    type: COMMANDS.shareRevoke,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id },
  });

  return { id, status: "accepted", correlationId: ctx.correlationId };
}
