import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SubmitApplicationBody, StatusUpdateBody, DocUploadBody } from "./validators.js";
import { buildPresignedUploadUrl } from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function submitApplication(ctx: RequestContext, body: SubmitApplicationBody & { citizenId: string }): Promise<Accepted> {
  const id = randomUUID();
  const refNo = `APP-${Date.now()}`;
  await queue.publish(COMMANDS.applicationSubmit, {
    messageId: id, type: COMMANDS.applicationSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, refNo, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateStatus(ctx: RequestContext, id: string, body: StatusUpdateBody): Promise<Accepted> {
  await queue.publish(COMMANDS.applicationStatusUpdate, {
    messageId: randomUUID(), type: COMMANDS.applicationStatusUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "application", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function uploadDocument(ctx: RequestContext, id: string, body: DocUploadBody): Promise<Accepted & { uploadUrl: string }> {
  const docId = randomUUID();
  const uploadUrl = buildPresignedUploadUrl(ctx.tenantId, id, body.docType);
  await queue.publish(COMMANDS.applicationDocUpload, {
    messageId: docId, type: COMMANDS.applicationDocUpload,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id: docId, applicationId: id, tenantId: ctx.tenantId, ...body },
  });
  return { id: docId, status: "accepted", correlationId: ctx.correlationId, uploadUrl };
}
