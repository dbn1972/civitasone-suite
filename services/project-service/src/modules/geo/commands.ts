import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { presignedPutUrl } from "@civitasone/storage";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { GeoTagBody, PhotoUploadBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * DOM-015: this endpoint used to unconditionally fabricate
 * `...?presigned=placeholder` and hand it back as `uploadUrl` — a string that
 * *looks* like a real presigned S3 URL but a client's PUT to it would just
 * fail. Now env-gated the same way inspection-service's evidence upload is
 * (services/inspection-service/src/modules/evidence/routes.ts): a REAL SigV4
 * presigned PUT URL (via the shared `@civitasone/storage` adapter, so no S3
 * network call is needed to mint it — presigning is offline HMAC signing)
 * when AWS credentials are actually present, and an explicit `not_configured`
 * status — never a fake URL — otherwise.
 */
export type PresignedUrlResponse =
  | { id: string; status: "ready"; uploadUrl: string; s3Key: string; correlationId: string }
  | { id: string; status: "not_configured"; reason: string; s3Key: string; correlationId: string };

function storageConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY);
}

export async function geoTag(ctx: RequestContext, projectId: string, body: GeoTagBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.geoTag, {
    messageId: id, type: COMMANDS.geoTag,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, taggedBy: ctx.actorId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "geo", projectId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function requestPhotoUpload(ctx: RequestContext, projectId: string, body: PhotoUploadBody): Promise<PresignedUrlResponse> {
  const id = randomUUID();
  const s3Key = `projects/${projectId}/${id}/${body.originalName}`;
  await queue.publish(COMMANDS.photoUpload, {
    messageId: id, type: COMMANDS.photoUpload,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, projectId, s3Key, uploadedBy: ctx.actorId, ...body },
  });

  if (!storageConfigured()) {
    // Explicit "not configured" — never a fabricated upload URL.
    return {
      id,
      status: "not_configured",
      reason: "S3 storage is not configured (missing AWS credentials)",
      s3Key,
      correlationId: ctx.correlationId,
    };
  }

  const uploadUrl = await presignedPutUrl({ key: s3Key, contentType: body.contentType });
  return { id, status: "ready", uploadUrl, s3Key, correlationId: ctx.correlationId };
}
