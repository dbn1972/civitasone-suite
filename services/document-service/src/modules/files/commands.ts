import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE } from "../../topics.js";
import type { UploadFileBody } from "./validators.js";
import type { FileView } from "./schema.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function uploadFile(ctx: RequestContext, body: UploadFileBody): Promise<Accepted> {
  const id = randomUUID();
  const projected: FileView = {
    id,
    tenantId:   ctx.tenantId,
    folderId:   body.folderId ?? null,
    name:       body.name,
    mimeType:   body.mimeType ?? null,
    sizeBytes:  body.sizeBytes ?? null,
    storageKey: null,
    tags:       body.tags,
    status:     "active",
    version:    1,
    createdAt:  new Date(),
    updatedAt:  new Date(),
  };
  await cache.put(cache.makeKey(ctx.tenantId, RESOURCE, id), projected);
  await queue.publish(COMMANDS.fileUpload, {
    messageId: id,
    type: COMMANDS.fileUpload,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: projected,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteFile(ctx: RequestContext, fileId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.fileDelete, {
    messageId: id,
    type: COMMANDS.fileDelete,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { fileId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function moveFile(ctx: RequestContext, fileId: string, folderId: string | null): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.fileMove, {
    messageId: id,
    type: COMMANDS.fileMove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { fileId, folderId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function tagFile(ctx: RequestContext, fileId: string, tags: string[]): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.fileTag, {
    messageId: id,
    type: COMMANDS.fileTag,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { fileId, tags },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
