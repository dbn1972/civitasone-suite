/**
 * Command publishers for the bulk-scan module. Routes call these; NOTHING here (or in routes) writes the DB.
 * Every command carries a randomUUID() messageId that is also the id returned to the caller (202 + id);
 * the consumer applies it with markProcessed (redelivery-safe) inside a transaction.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { BulkScanSettings, CreateBatchBody, CreateProfileBody, UpdateProfileBody } from "./validators.js";

export type Accepted = { id: string; status: "accepted"; correlationId: string };

async function publish(ctx: RequestContext, topic: string, payload: Record<string, unknown>, id: string = randomUUID()): Promise<Accepted> {
  await queue.publish(topic, {
    messageId: id, type: topic, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export interface RegisteredFile { id: string; name: string; mimeType: string; sizeBytes: number; storageKey: string }

export const createBatch = (ctx: RequestContext, body: CreateBatchBody): Promise<Accepted> => {
  const id = randomUUID();
  return publish(ctx, COMMANDS.bulkBatchCreate, { batchId: id, ...body }, id);
};
export const cancelBatch = (ctx: RequestContext, batchId: string): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkBatchCancel, { batchId });
export const registerFiles = (ctx: RequestContext, batchId: string, files: RegisteredFile[]): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkFilesRegister, { batchId, files });
export const completeFiles = (ctx: RequestContext, batchId: string, fileIds: string[]): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkFilesComplete, { batchId, fileIds });
export const retryFile = (ctx: RequestContext, fileId: string, reason?: string): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkFileRetry, { fileId, ...(reason ? { reason } : {}) });
export const skipFile = (ctx: RequestContext, fileId: string, reason?: string): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkFileSkip, { fileId, ...(reason ? { reason } : {}) });

// settings (maker-checker)
export const proposeSettings = (ctx: RequestContext, settings: BulkScanSettings, reason?: string): Promise<Accepted> => {
  const id = randomUUID();
  return publish(ctx, COMMANDS.bulkSettingsPropose, { requestId: id, settings, ...(reason ? { reason } : {}) }, id);
};
/** The approver's roles are stamped from the verified JWT; the consumer derives "is super_admin" from them (never from a boolean claim). */
export const approveSettingsChange = (ctx: RequestContext, requestId: string, reason?: string): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkSettingsApprove, { requestId, actorRoles: [...ctx.roles], ...(reason ? { reason } : {}) });
export const rejectSettingsChange = (ctx: RequestContext, requestId: string, reason: string): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkSettingsReject, { requestId, reason });

// profiles
export const createProfile = (ctx: RequestContext, body: CreateProfileBody): Promise<Accepted> => {
  const id = randomUUID();
  return publish(ctx, COMMANDS.bulkProfileCreate, { profileId: id, ...body }, id);
};
export const updateProfile = (ctx: RequestContext, profileId: string, body: UpdateProfileBody): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkProfileUpdate, { profileId, ...body });
/** A profile change that overrides a sensitive field: becomes a change request needing a second approver. id = the request id. */
export const proposeProfileChange = (ctx: RequestContext, a: { profileId: string; change: Record<string, unknown>; reason?: string | undefined }): Promise<Accepted> => {
  const id = randomUUID();
  return publish(ctx, COMMANDS.bulkProfileChangePropose, { requestId: id, profileId: a.profileId, change: a.change, ...(a.reason ? { reason: a.reason } : {}) }, id);
};
export const deleteProfile = (ctx: RequestContext, profileId: string): Promise<Accepted> =>
  publish(ctx, COMMANDS.bulkProfileDelete, { profileId });
