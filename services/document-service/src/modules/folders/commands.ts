import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateFolderBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createFolder(ctx: RequestContext, body: CreateFolderBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.folderCreate, {
    messageId: id,
    type: COMMANDS.folderCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, name: body.name, parentId: body.parentId ?? null, path: "/" },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function renameFolder(ctx: RequestContext, folderId: string, name: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.folderRename, {
    messageId: id, type: COMMANDS.folderRename, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { folderId, name },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function moveFolder(ctx: RequestContext, folderId: string, parentId: string | null): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.folderMove, {
    messageId: id, type: COMMANDS.folderMove, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { folderId, parentId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
