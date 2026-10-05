/**
 * Batch lifecycle routes. READ handlers query; WRITE handlers only validate (zod) and publish a command
 * (202 + id). No DB writes here (CQRS) - see consumer.ts.
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { acceptedResponseSchema } from "@civitasone/schemas/common";
import { sendAccepted } from "@civitasone/schemas/validate";
import { resolveContext, requireRole, HttpError } from "../../shared/context.js";
import { BULK_SCAN_ROLES, installBulkScanErrorHandler } from "./http.js";
import {
  createBatchBody, uploadUrlsBody, completeFilesBody, fileActionBody, listBatchesQuery, listBatchFilesQuery, idParam, batchFileParams,
} from "./validators.js";
import * as commands from "./commands.js";
import * as queries from "./queries.js";
import * as repo from "./repo.js";
import { keys } from "./keys.js";
import { checkUploadLimits } from "./limits.js";
import { getPorts } from "./ports.js";
import { PERMANENT_FAILURE_REASONS, SKIPPABLE_STATES, isFileState } from "./state.js";

const PRESIGN_EXPIRES_S = Number(process.env.BULK_SCAN_PRESIGN_TTL_S ?? 900);
const P = "/v1/documents/bulk-scan";

export async function bulkScanRoutes(app: FastifyInstance): Promise<void> {
  // Create a batch
  app.post(`${P}/batches`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const body = createBatchBody.parse(req.body);
    const eff = await repo.resolveEffectiveSettings(ctx.tenantId, body.profileId ?? null);
    if (body.profileId && !eff.profileId) throw new HttpError(422, "UNKNOWN_PROFILE", "scan profile not found");
    if (body.defaultDocType && !eff.settings.classification.docTypes.some((d) => d.id === body.defaultDocType)) {
      throw new HttpError(422, "UNKNOWN_DOC_TYPE", "default document type is not configured for this tenant");
    }
    if (body.linkTarget && !eff.settings.allowedLinkTargets.includes(body.linkTarget.target)) {
      throw new HttpError(422, "LINK_TARGET_NOT_ALLOWED", "link target is not enabled for this tenant");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.createBatch(ctx, body));
  });

  app.get(`${P}/batches`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const q = listBatchesQuery.parse(req.query);
    return reply.send(await queries.listBatches(ctx.tenantId, q));
  });

  app.get(`${P}/batches/:id`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const b = await queries.getBatch(ctx.tenantId, id);
    if (!b) throw new HttpError(404, "NOT_FOUND", "batch not found");
    return reply.send(b);
  });

  app.post(`${P}/batches/:id/cancel`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const b = await repo.getBatch(ctx.tenantId, id);
    if (!b) throw new HttpError(404, "NOT_FOUND", "batch not found");
    if (b.status === "cancelled") throw new HttpError(409, "ALREADY_CANCELLED", "batch is already cancelled");
    return sendAccepted(reply, acceptedResponseSchema, await commands.cancelBatch(ctx, id));
  });

  // Presigned upload URLs for N files (limits enforced here for fast feedback, and atomically in the consumer).
  app.post(`${P}/batches/:id/files/upload-urls`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = uploadUrlsBody.parse(req.body);
    const batch = await repo.getBatch(ctx.tenantId, id);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "batch not found");
    if (batch.status === "cancelled") throw new HttpError(409, "BATCH_CANCELLED", "batch is cancelled");
    const eff = await repo.resolveEffectiveSettings(ctx.tenantId, batch.profileId);
    const violation = checkUploadLimits(eff.settings.limits, { fileCount: batch.fileCount, totalBytes: batch.totalBytes }, body.files);
    if (violation) throw new HttpError(422, violation.code, `upload limit exceeded (${violation.code}, limit ${violation.limit})`);

    const store = getPorts().store;
    const registered: commands.RegisteredFile[] = body.files.map((f) => {
      const fileId = randomUUID();
      return { id: fileId, name: f.name, mimeType: f.mimeType, sizeBytes: f.sizeBytes, storageKey: keys.original(ctx.tenantId, id, fileId) };
    });
    const uploads = await Promise.all(registered.map(async (f) => {
      const s = await store.presignPut({ key: f.storageKey, contentType: f.mimeType, contentLength: f.sizeBytes, expiresIn: PRESIGN_EXPIRES_S });
      return { fileId: f.id, name: f.name, method: "PUT" as const, url: s.url, headers: s.headers, expiresInSeconds: PRESIGN_EXPIRES_S };
    }));
    const accepted = await commands.registerFiles(ctx, id, registered);
    return reply.code(202).send({ ...accepted, data: { id: accepted.id, batchId: id, uploads } });
  });

  // Client finished uploading: verify (HEAD, magic bytes, sha256), duplicate policy, start the pipeline.
  app.post(`${P}/batches/:id/files/complete`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const body = completeFilesBody.parse(req.body);
    const batch = await repo.getBatch(ctx.tenantId, id);
    if (!batch) throw new HttpError(404, "NOT_FOUND", "batch not found");
    if (batch.status === "cancelled") throw new HttpError(409, "BATCH_CANCELLED", "batch is cancelled");
    return sendAccepted(reply, acceptedResponseSchema, await commands.completeFiles(ctx, id, body.files.map((f) => f.fileId)));
  });

  app.get(`${P}/batches/:id/files`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { id } = idParam.parse(req.params);
    const q = listBatchFilesQuery.parse(req.query);
    if (!(await repo.getBatch(ctx.tenantId, id))) throw new HttpError(404, "NOT_FOUND", "batch not found");
    return reply.send(await queries.listBatchFiles(ctx.tenantId, id, q));
  });

  app.get(`${P}/batches/:batchId/files/:fileId`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const f = await queries.getFile(ctx.tenantId, fileId);
    if (!f || f.batchId !== batchId) throw new HttpError(404, "NOT_FOUND", "file not found");
    return reply.send({ ...f, events: await queries.fileEvents(ctx.tenantId, fileId) });
  });

  // Resumable uploads: re-issue a fresh presigned PUT for an EXISTING pending_upload file (same server-chosen key,
  // same limits). A presign is not a DB write, so no command is needed.
  app.post(`${P}/batches/:batchId/files/:fileId/upload-url`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const f = await repo.getFile(ctx.tenantId, fileId);
    if (!f || f.batchId !== batchId) throw new HttpError(404, "NOT_FOUND", "file not found");
    if (f.state !== "pending_upload") throw new HttpError(409, "NOT_PENDING_UPLOAD", `a file in state ${f.state} cannot be uploaded again`);
    const batch = await repo.getBatch(ctx.tenantId, batchId);
    if (!batch || batch.status === "cancelled") throw new HttpError(409, "BATCH_CANCELLED", "batch is cancelled");
    const eff = await repo.resolveEffectiveSettings(ctx.tenantId, batch.profileId);
    if (f.declaredSizeBytes > eff.settings.limits.maxFileBytes) throw new HttpError(422, "FILE_TOO_LARGE", `upload limit exceeded (FILE_TOO_LARGE, limit ${eff.settings.limits.maxFileBytes})`);
    const s = await getPorts().store.presignPut({ key: f.storageKey, contentType: f.mimeType ?? "application/octet-stream", contentLength: f.declaredSizeBytes, expiresIn: PRESIGN_EXPIRES_S });
    return reply.send({ data: { fileId: f.id, method: "PUT", url: s.url, headers: s.headers, expiresInSeconds: PRESIGN_EXPIRES_S } });
  });

  app.post(`${P}/batches/:batchId/files/:fileId/retry`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const body = fileActionBody.parse(req.body ?? {});
    const f = await repo.getFile(ctx.tenantId, fileId);
    if (!f || f.batchId !== batchId) throw new HttpError(404, "NOT_FOUND", "file not found");
    if (f.retentionDeletedAt) throw new HttpError(409, "FILE_PURGED", "the file's objects were deleted by retention; upload it again");
    if (f.state !== "failed" || !f.failureReason || PERMANENT_FAILURE_REASONS.includes(f.failureReason)) {
      throw new HttpError(409, "NOT_RETRYABLE", "only files that failed for a transient reason can be retried");
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.retryFile(ctx, fileId, body.reason));
  });

  app.post(`${P}/batches/:batchId/files/:fileId/skip`, async (req, reply) => {
    const ctx = resolveContext(req);
    requireRole(ctx, BULK_SCAN_ROLES);
    const { batchId, fileId } = batchFileParams.parse(req.params);
    const body = fileActionBody.parse(req.body ?? {});
    const f = await repo.getFile(ctx.tenantId, fileId);
    if (!f || f.batchId !== batchId) throw new HttpError(404, "NOT_FOUND", "file not found");
    if (!isFileState(f.state) || !SKIPPABLE_STATES.includes(f.state)) {
      throw new HttpError(409, "NOT_SKIPPABLE", `a file in state ${f.state} cannot be skipped`);
    }
    return sendAccepted(reply, acceptedResponseSchema, await commands.skipFile(ctx, fileId, body.reason));
  });

  installBulkScanErrorHandler(app);
}
