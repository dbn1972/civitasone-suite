/**
 * visitor-service: identity verification command publishers.
 *
 * Thin CQRS publishers (route → zod validate → publish → 202 pattern).
 *
 * `digilockerVerify` — publishes a command for the consumer to invoke the
 * DigiLocker adapter and update `visit_requests.identity_verified` /
 * `identity_method` on success (Requirements 7.2, 7.3).
 *
 * `aadhaarFaceMatch` — publishes a command for the consumer to invoke the
 * Aadhaar face-match adapter and update the visit request. On a match
 * failure below the confidence threshold, the consumer also creates a
 * security incident and notifies the security control room (Requirements
 * 8.3, 8.5).
 *
 * Neither publisher persists PII — the DigiLocker URI and face photo are
 * opaque tokens passed via the queue payload and never retained in the
 * outbox or logs (DPDP data minimization, Property 14).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

// ── DigiLocker Verify ─────────────────────────────────────────────

export interface DigilockerVerifyInput {
  visitRequestId: string;
  /** DigiLocker document URI — passed transiently; never persisted by this publisher. */
  digilockerUri: string;
}

/**
 * Requirement 7.1/7.2: publishes a command for the identity consumer to
 * invoke the DigiLocker adapter and mark the visit request as identity-verified.
 */
export async function digilockerVerify(ctx: RequestContext, input: DigilockerVerifyInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.digilockerVerify, {
    messageId,
    type: COMMANDS.digilockerVerify,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      visitRequestId: input.visitRequestId,
      digilockerUri: input.digilockerUri,
    },
  });
  return { id: input.visitRequestId, status: "accepted", correlationId: ctx.correlationId };
}

// ── Aadhaar Face Match ────────────────────────────────────────────

export interface AadhaarFaceMatchInput {
  visitRequestId: string;
  /** Aadhaar reference token — opaque, never the raw Aadhaar number. */
  aadhaarRef: string;
  /** Live photo base64 — transient; consumer invokes adapter and discards. */
  livePhotoBase64: string;
  /** Optional tenant-specific confidence threshold override (default 95). */
  confidenceThreshold?: number;
}

/**
 * Requirement 8.1/8.2/8.3: publishes a command for the identity consumer to
 * invoke the Aadhaar face-match adapter. On match below threshold the
 * consumer creates a security incident (Requirement 8.3) and schedules
 * biometric photo deletion 24h post-checkout (Requirement 8.5).
 */
export async function aadhaarFaceMatch(ctx: RequestContext, input: AadhaarFaceMatchInput): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.aadhaarFaceMatch, {
    messageId,
    type: COMMANDS.aadhaarFaceMatch,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      visitRequestId: input.visitRequestId,
      aadhaarRef: input.aadhaarRef,
      livePhotoBase64: input.livePhotoBase64,
      confidenceThreshold: input.confidenceThreshold ?? undefined,
    },
  });
  return { id: input.visitRequestId, status: "accepted", correlationId: ctx.correlationId };
}
