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

export async function uploadDocument(ctx: RequestContext, id: string, body: DocUploadBody & { ownerCitizenId?: string | null }): Promise<Accepted & { uploadUrl: string }> {
  const docId = randomUUID();
  const uploadUrl = buildPresignedUploadUrl(ctx.tenantId, id, body.docType);
  await queue.publish(COMMANDS.applicationDocUpload, {
    messageId: docId, type: COMMANDS.applicationDocUpload,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    // P0-1: bind to the owner verified at the route; the consumer re-asserts.
    payload: { id: docId, applicationId: id, tenantId: ctx.tenantId, docType: body.docType, ownerCitizenId: body.ownerCitizenId ?? null },
  });
  return { id: docId, status: "accepted", correlationId: ctx.correlationId, uploadUrl };
}

export async function saveDraft(
  ctx: RequestContext,
  body: {
    citizenId: string;
    serviceId: string;
    serviceKey?: string | undefined;
    channel: string;
    assistedBy: string | null;
    formData: Record<string, unknown>;
    documentTypes: string[];
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.draftSave, {
    messageId: id, type: COMMANDS.draftSave,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateDraft(
  ctx: RequestContext,
  id: string,
  body: { formData?: Record<string, unknown> | undefined; documentTypes?: string[] | undefined },
): Promise<Accepted> {
  await queue.publish(COMMANDS.draftUpdate, {
    messageId: randomUUID(), type: COMMANDS.draftUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitDraft(
  ctx: RequestContext,
  draftId: string,
  body: { documentTypes?: string[] | undefined; trackingNo: string; applicationId: string; channel: string },
): Promise<Accepted & { trackingNo: string; channel: string; applicationId: string }> {
  await queue.publish(COMMANDS.draftSubmit, {
    messageId: body.applicationId, type: COMMANDS.draftSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id: body.applicationId,
      draftId,
      tenantId: ctx.tenantId,
      trackingNo: body.trackingNo,
      channel: body.channel,
      documentTypes: body.documentTypes,
    },
  });
  return {
    id: body.applicationId,
    status: "accepted",
    correlationId: ctx.correlationId,
    trackingNo: body.trackingNo,
    channel: body.channel,
    applicationId: body.applicationId,
  };
}
