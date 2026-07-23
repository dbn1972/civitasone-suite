/**
 * inspection-service: sync module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * _Requirements: 6.1, 6.2, 6.6, 6.8_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

/** POST /sync/packages — request offline bundle generation. */
export interface SyncPackageGeneratePayload {
  inspectorId: string;
  inspectionIds?: string[] | undefined;
  includeMapTiles?: boolean | undefined;
}

/** POST /sync/upload — submit offline-completed data. */
export interface SyncUploadPayload {
  inspectorId: string;
  inspectionId: string;
  deviceId: string;
  sequenceNumber: number;
  payload: {
    responses: Record<string, { value?: unknown; answeredAt: string }>;
    evidence: Array<{ evidenceId: string; sha256: string }>;
  };
  sha256Hash: string;
  networkState: "online" | "offline";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(),
    type,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload,
  };
}

// ── Publish functions ─────────────────────────────────────────────────────────

export async function publishSyncPackageGenerate(
  payload: SyncPackageGeneratePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string; packageId: string }> {
  const packageId = randomUUID();
  const msg = envelope(ctx, COMMANDS.syncPackageGenerate, {
    ...payload,
    packageId,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.syncPackageGenerate, msg);
  return { accepted: true, messageId: msg.messageId, packageId };
}

export async function publishSyncUpload(
  payload: SyncUploadPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.syncUpload, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.syncUpload, msg);
  return { accepted: true, messageId: msg.messageId };
}
