import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateFileBody, AddNotingBody, MoveFileBody, CloseFileBody, CreateDispatchBody, RegisterInwardBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createFile(ctx: RequestContext, body: CreateFileBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.fileCreate, {
    messageId: id, type: COMMANDS.fileCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function addNoting(ctx: RequestContext, fileId: string, body: AddNotingBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.notingAdd, {
    messageId: id, type: COMMANDS.notingAdd,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, fileId, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function moveFile(ctx: RequestContext, fileId: string, body: MoveFileBody): Promise<Accepted> {
  await queue.publish(COMMANDS.fileMove, {
    type: COMMANDS.fileMove,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id: fileId, status: "accepted", correlationId: ctx.correlationId };
}

export async function closeFile(ctx: RequestContext, fileId: string, body: CloseFileBody): Promise<Accepted> {
  await queue.publish(COMMANDS.fileClose, {
    type: COMMANDS.fileClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id: fileId, status: "accepted", correlationId: ctx.correlationId };
}

export async function createDispatch(ctx: RequestContext, body: CreateDispatchBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.dispatchCreate, {
    messageId: id, type: COMMANDS.dispatchCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function registerInward(ctx: RequestContext, body: RegisterInwardBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.inwardRegister, {
    messageId: id, type: COMMANDS.inwardRegister,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
