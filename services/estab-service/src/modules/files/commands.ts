import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type {
  CreateFileBody, AddNotingBody, MoveFileBody, CloseFileBody,
  CreateDispatchBody, RegisterInwardBody, SubmitNotingBody, OpenFileFromInwardBody,
  AddAttachmentBody, RecallFileBody, ReopenFileBody, AttachInwardBody, DetachInwardBody,
  DeliveryUpdateBody,
} from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createFile(ctx: RequestContext, body: CreateFileBody): Promise<Accepted> {
  const id = randomUUID();
  // CSMOP gapless file number is allocated server-side in the consumer (per
  // section+year). A caller-supplied fileNo is honoured only for legacy mapping.
  const section = body.section ?? body.dept;
  await queue.publish(COMMANDS.fileCreate, {
    messageId: id, type: COMMANDS.fileCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, section },
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

export async function submitNotingForApproval(
  ctx: RequestContext,
  fileId: string,
  body: SubmitNotingBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.notingSubmit, {
    type: COMMANDS.notingSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, notingId: body.notingId, tenantId: ctx.tenantId },
  });
  return { id: body.notingId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Sign (green) a specific noting authored at this officer's level. Each level's
 * note is individually signed and tamper-evidently hash-chained, so the file
 * accumulates a chain of green notes (SO → US → DS), matching eFile fidelity —
 * not a single note greened only at the end.
 */
export async function signNoting(ctx: RequestContext, fileId: string, notingId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.notingSign, {
    type: COMMANDS.notingSign,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, notingId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id: notingId, status: "accepted", correlationId: ctx.correlationId };
}

export async function openFileFromInward(
  ctx: RequestContext,
  inwardId: string,
  body: OpenFileFromInwardBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.inwardOpenFile, {
    messageId: id, type: COMMANDS.inwardOpenFile,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, inwardId, tenantId: ctx.tenantId, section: body.dept, ...body },
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

export async function recallFile(ctx: RequestContext, fileId: string, body: RecallFileBody): Promise<Accepted> {
  await queue.publish(COMMANDS.fileRecall, {
    type: COMMANDS.fileRecall,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id: fileId, status: "accepted", correlationId: ctx.correlationId };
}

export async function reopenFile(ctx: RequestContext, fileId: string, body: ReopenFileBody): Promise<Accepted> {
  await queue.publish(COMMANDS.fileReopen, {
    type: COMMANDS.fileReopen,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { fileId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "file", fileId));
  return { id: fileId, status: "accepted", correlationId: ctx.correlationId };
}

export async function attachInward(ctx: RequestContext, body: AttachInwardBody, fileId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.inwardAttach, {
    messageId: id, type: COMMANDS.inwardAttach,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, inwardId: body.inwardId, fileId },
  });
  return { id: body.inwardId, status: "accepted", correlationId: ctx.correlationId };
}

export async function detachInward(ctx: RequestContext, body: DetachInwardBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.inwardDetach, {
    messageId: id, type: COMMANDS.inwardDetach,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, inwardId: body.inwardId, reason: body.reason },
  });
  return { id: body.inwardId, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDelivery(ctx: RequestContext, body: DeliveryUpdateBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.dispatchDelivery, {
    messageId: id, type: COMMANDS.dispatchDelivery,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId: ctx.tenantId, ...body },
  });
  return { id: body.dispatchId, status: "accepted", correlationId: ctx.correlationId };
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

export async function addAttachment(
  ctx: RequestContext,
  fileId: string,
  body: AddAttachmentBody,
): Promise<Accepted> {
  const id = randomUUID();
  const storageRef = body.storageRef ?? (body.contentBase64 ? `inline:${body.contentBase64.slice(0, 64)}…` : null);
  const sizeBytes = body.sizeBytes || (body.contentBase64 ? Math.ceil(body.contentBase64.length * 0.75) : 0);
  await queue.publish(COMMANDS.fileAttachmentAdd, {
    messageId: id, type: COMMANDS.fileAttachmentAdd,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, fileId, tenantId: ctx.tenantId,
      fileName: body.fileName,
      fileType: body.fileType,
      sizeBytes,
      storageRef,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
