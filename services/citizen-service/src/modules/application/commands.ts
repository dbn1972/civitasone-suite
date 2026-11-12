import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { SubmitApplicationBody, StatusUpdateBody, DocUploadBody } from "./validators.js";
import { presignedPutUrl } from "@civitasone/storage";
import { HttpError } from "../../shared/context.js";
import { validateUpload, PUT_URL_TTL_SECONDS, DOCUMENT_UPLOAD_LIMITS } from "../documents/storage.js";
import { buildApplicationDocumentKey } from "./docs-storage.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function submitApplication(ctx: RequestContext, body: SubmitApplicationBody & { citizenId: string }): Promise<Accepted> {
  const id = randomUUID();
  // refNo is allocated by the consumer from a Postgres sequence inside the insert transaction
  // (shared/numbers.ts) -- never generated here, so a retry cannot replay a colliding value.
  await queue.publish(COMMANDS.applicationSubmit, {
    messageId: id, type: COMMANDS.applicationSubmit,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
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

export interface DocumentUploadTicket {
  id: string;
  /** SigV4 presigned PUT: the client uploads the bytes straight to object storage with `headers`. */
  uploadUrl: string;
  method: "PUT";
  key: string;
  expiresIn: number;
  maxSizeMb: number;
  headers: Record<string, string>;
}
/**
 * The upload ticket rides in the standard `data` envelope: acceptedResponseSchema strips unknown
 * top-level keys (the old flat `uploadUrl` never reached the client), `data` is passthrough.
 */
export type DocumentUploadAccepted = Accepted & { data: DocumentUploadTicket };

/**
 * Real document handling: validate the file (type + size), mint a short-lived presigned PUT for a
 * tenant/application-namespaced object key, and queue the row that records that KEY (never a URL).
 * The caller's ownership of the application was asserted by the route; the consumer re-asserts it.
 */
export async function uploadDocument(ctx: RequestContext, id: string, body: DocUploadBody & { ownerCitizenId?: string | null }): Promise<DocumentUploadAccepted> {
  if (!body.filename || !body.contentType || body.sizeBytes === undefined) {
    throw new HttpError(400, "FILE_REQUIRED", "filename, contentType and sizeBytes are required to upload a document");
  }
  const invalid = validateUpload({ filename: body.filename, contentType: body.contentType, sizeBytes: body.sizeBytes });
  if (invalid) throw new HttpError(400, invalid.code, invalid.message);

  const docId = randomUUID();
  const key = buildApplicationDocumentKey(ctx.tenantId, id, body.filename);
  const uploadUrl = await presignedPutUrl({
    key,
    contentType: body.contentType,
    contentLength: body.sizeBytes,
    expiresIn: PUT_URL_TTL_SECONDS,
    serverSideEncryption: "AES256",
  });
  await queue.publish(COMMANDS.applicationDocUpload, {
    messageId: docId, type: COMMANDS.applicationDocUpload,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    // P0-1: bind to the owner verified at the route; the consumer re-asserts.
    payload: {
      id: docId, applicationId: id, tenantId: ctx.tenantId, docType: body.docType,
      ownerCitizenId: body.ownerCitizenId ?? null,
      storageKey: key, contentType: body.contentType, sizeBytes: body.sizeBytes, filename: body.filename,
    },
  });
  return {
    id: docId, status: "accepted", correlationId: ctx.correlationId,
    data: {
      id: docId, uploadUrl, method: "PUT", key, expiresIn: PUT_URL_TTL_SECONDS, maxSizeMb: DOCUMENT_UPLOAD_LIMITS.maxSizeMb,
      headers: { "Content-Type": body.contentType, "x-amz-server-side-encryption": "AES256" },
    },
  };
}

export async function saveDraft(
  ctx: RequestContext,
  body: {
    citizenId: string;
    serviceId: string;
    serviceKey?: string | undefined;
    channel: string;
    assistedBy: string | null;
    applicantType: string;
    formData: Record<string, unknown>;
    documentTypes: string[];
    assistedConsent?: boolean | undefined;
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
  body: {
    formData?: Record<string, unknown> | undefined;
    documentTypes?: string[] | undefined;
    applicantType?: string | undefined;
  },
): Promise<Accepted> {
  await queue.publish(COMMANDS.draftUpdate, {
    messageId: randomUUID(), type: COMMANDS.draftUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteDraft(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.draftDelete, {
    messageId: randomUUID(), type: COMMANDS.draftDelete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function submitDraft(
  ctx: RequestContext,
  draftId: string,
  body: {
    documentTypes?: string[] | undefined;
    trackingNo: string;
    applicationId: string;
    channel: string;
    applicantType: string;
  },
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
      applicantType: body.applicantType,
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
