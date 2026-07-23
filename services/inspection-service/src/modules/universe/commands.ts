/**
 * inspection-service: universe module — command publishing helpers.
 *
 * Each function takes a payload + RequestContext, wraps it in the standard
 * CivitasOne CommandEnvelope, and publishes to the queue. Routes call these
 * after zod validation, then return 202 Accepted.
 *
 * Envelope shape: { messageId, type, tenantId, actorId, correlationId,
 *   schemaVersion, payload }
 *
 * _Requirements: 2.1, 2.2, 2.7_
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

// ── Payload types ─────────────────────────────────────────────────────────────

export interface EntityCreatePayload {
  registrationNo: string;
  entityType: string;
  name: string;
  jurisdiction: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state: string;
  pincode: string;
  latitude?: string;
  longitude?: string;
  riskCategory: string;
  metadata?: Record<string, unknown>;
}

export interface EntityUpdatePayload {
  entityId: string;
  version: number;
  patch: Record<string, unknown>;
}

export interface InspectionTypeCreatePayload {
  code: string;
  name: string;
  applicableEntityTypes: string[];
  requiredCompetencies: string[];
  defaultTemplateIds?: string[];
  regulatoryBasis?: unknown;
}

export interface ProvisionCreatePayload {
  actReference: string;
  sectionNumber: string;
  description: string;
  penaltyClause?: string;
  severityClassification: string;
}

export interface VocabularyUpsertPayload {
  category: string;
  code: string;
  label: string;
  description?: string;
  sortOrder?: number;
  effectiveFrom?: string;
  effectiveTo?: string;
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

export async function publishEntityCreate(
  payload: EntityCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.entityCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.entityCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishEntityUpdate(
  payload: EntityUpdatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.entityUpdate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.entityUpdate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishInspectionTypeCreate(
  payload: InspectionTypeCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.inspectionTypeCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.inspectionTypeCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishProvisionCreate(
  payload: ProvisionCreatePayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.provisionCreate, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.provisionCreate, msg);
  return { accepted: true, messageId: msg.messageId };
}

export async function publishVocabularyUpsert(
  payload: VocabularyUpsertPayload,
  ctx: RequestContext,
): Promise<{ accepted: true; messageId: string }> {
  const msg = envelope(ctx, COMMANDS.vocabularyUpsert, { ...payload, tenantId: ctx.tenantId });
  await queue.publish(COMMANDS.vocabularyUpsert, msg);
  return { accepted: true, messageId: msg.messageId };
}
