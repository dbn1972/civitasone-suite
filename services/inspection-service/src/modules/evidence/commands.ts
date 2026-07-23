/**
 * inspection-service: evidence module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.8_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

/** POST /evidence — register evidence metadata after presigned upload. */
export interface EvidenceRegisterPayload {
  inspectionId: string;
  findingId?: string | undefined;
  sha256Hash: string;
  mimeType: string;
  fileSizeBytes: number;
  s3Key: string;
  captureLatitude?: string | undefined;
  captureLongitude?: string | undefined;
  captureTimestamp: string;
  deviceId: string;
  inspectorId: string;
}

/** POST /evidence/:id/verify — trigger integrity re-verification. */
export interface EvidenceVerifyIntegrityPayload {
  evidenceId: string;
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

export async function publishEvidenceRegister(
  payload: EvidenceRegisterPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string; evidenceId: string }> {
  const evidenceId = randomUUID();
  const msg = envelope(ctx, COMMANDS.evidenceRegister, {
    ...payload,
    evidenceId,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.evidenceRegister, msg);
  return { accepted: true, messageId: msg.messageId, evidenceId };
}

export async function publishEvidenceVerifyIntegrity(
  payload: EvidenceVerifyIntegrityPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.evidenceVerifyIntegrity, {
    ...payload,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.evidenceVerifyIntegrity, msg);
  return { accepted: true, messageId: msg.messageId };
}
