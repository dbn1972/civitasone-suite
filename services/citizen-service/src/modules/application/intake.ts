import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError, resolveCitizenId, isOfficer } from "../../shared/context.js";
import * as intakeRepo from "./intake-repo.js";
import * as appRepo from "./repo.js";
import { buildTrackingNumber, resolveAssistedBy, isAssistedChannel, type IntakeChannel } from "./intake-domain.js";
import type { SaveDraftBody, UpdateDraftBody, SubmitDraftBody } from "./intake-validators.js";

async function audit(tx: Parameters<typeof enqueue>[0], ctx: RequestContext, action: string, resourceId: string): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record", eventType: "audit.event.record",
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
    payload: { service: "citizen", action, resourceType: "application_intake", resourceId, outcome: "success" },
  });
}

/**
 * Save a DRAFT application (online or assisted). For assisted/counter channels
 * the operator-on-behalf-of id is recorded (assisted_by). A citizen may only
 * draft for themselves; an officer may draft on behalf of any citizen.
 */
export async function saveDraft(ctx: RequestContext, body: SaveDraftBody): Promise<{ id: string; status: string; channel: string; assistedBy: string | null }> {
  const citizenId = resolveCitizenId(ctx, body.citizenId);
  const channel = body.channel as IntakeChannel;
  // Assisted/counter entry requires an operator; default to the acting officer.
  const operatorId = isAssistedChannel(channel) ? (body.operatorId ?? ctx.actorId) : undefined;
  let assistedBy: string | null;
  try {
    assistedBy = resolveAssistedBy(channel, operatorId);
  } catch {
    throw new HttpError(422, "ASSISTED_OPERATOR_REQUIRED", "assisted/counter intake requires an operator id");
  }
  if (assistedBy && !isOfficer(ctx)) {
    throw new HttpError(403, "FORBIDDEN", "assisted intake requires an officer-tier operator");
  }
  const id = randomUUID();
  await db.transaction(async (tx) => {
    await intakeRepo.insertDraft(tx, {
      id, tenantId: ctx.tenantId, citizenId, serviceId: body.serviceId,
      serviceKey: body.serviceKey ?? null, channel, assistedBy,
      formData: body.formData, documentTypes: body.documentTypes, status: "draft",
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "draft_save", id);
  });
  return { id, status: "draft", channel, assistedBy };
}

/** Resume/update a draft (only while still in draft state). */
export async function updateDraft(ctx: RequestContext, id: string, body: UpdateDraftBody): Promise<{ id: string; status: string }> {
  return db.transaction(async (tx) => {
    const draft = await intakeRepo.findDraftByIdTx(tx, id, ctx.tenantId);
    if (!draft) throw new HttpError(404, "NOT_FOUND", "draft not found");
    if (!isOfficer(ctx) && draft.citizenId !== ctx.actorId) throw new HttpError(404, "NOT_FOUND", "draft not found");
    if (draft.status !== "draft") throw new HttpError(409, "INVALID_STATE", "only a draft can be updated");
    await intakeRepo.updateDraft(tx, id, ctx.tenantId, {
      ...(body.formData ? { formData: body.formData } : {}),
      ...(body.documentTypes ? { documentTypes: body.documentTypes } : {}),
      updatedBy: ctx.actorId,
    });
    await audit(tx, ctx, "draft_update", id);
    return { id, status: "draft" };
  });
}

/**
 * Submit a draft → creates the application and returns an ACKNOWLEDGEMENT with a
 * unique tracking number. Channel attribution + assisted operator carry over
 * from the draft. Idempotent-ish: a re-submit of an already-submitted draft 409s.
 */
export async function submitDraft(ctx: RequestContext, id: string, body: SubmitDraftBody): Promise<{
  applicationId: string; trackingNo: string; status: string; channel: string; acknowledgedAt: string;
}> {
  return db.transaction(async (tx) => {
    const draft = await intakeRepo.findDraftByIdTx(tx, id, ctx.tenantId);
    if (!draft) throw new HttpError(404, "NOT_FOUND", "draft not found");
    if (!isOfficer(ctx) && draft.citizenId !== ctx.actorId) throw new HttpError(404, "NOT_FOUND", "draft not found");
    if (draft.status !== "draft") throw new HttpError(409, "ALREADY_SUBMITTED", "draft has already been submitted");
    const applicationId = randomUUID();
    const trackingNo = buildTrackingNumber();
    const now = new Date();
    await appRepo.insertApplication(tx, {
      id: applicationId, tenantId: ctx.tenantId, citizenId: draft.citizenId, serviceId: draft.serviceId,
      refNo: trackingNo, status: "submitted", trackingNo, channel: draft.channel,
      assistedBy: draft.assistedBy, acknowledgedAt: now, submittedAt: now,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await appRepo.insertStatusHistory(tx, {
      tenantId: ctx.tenantId, applicationId, fromStatus: null, toStatus: "submitted",
      note: `Acknowledged via ${draft.channel} (tracking ${trackingNo})`,
      createdBy: ctx.actorId, updatedBy: ctx.actorId,
    });
    await intakeRepo.updateDraft(tx, id, ctx.tenantId, { status: "submitted", applicationId, updatedBy: ctx.actorId });
    await audit(tx, ctx, "draft_submit", applicationId);
    return { applicationId, trackingNo, status: "submitted", channel: draft.channel, acknowledgedAt: now.toISOString() };
  });
}

// ── queries ────────────────────────────────────────────────────────────────
export async function getDraft(ctx: RequestContext, id: string) {
  const draft = await intakeRepo.findDraftById(id, ctx.tenantId);
  if (!draft) return null;
  if (!isOfficer(ctx) && draft.citizenId !== ctx.actorId) return null;
  return draft;
}

export async function listDrafts(ctx: RequestContext, suppliedCitizenId?: string) {
  const citizenId = resolveCitizenId(ctx, suppliedCitizenId);
  return intakeRepo.listDraftsByCitizen(ctx.tenantId, citizenId);
}

/** Public-ish acknowledgement lookup by tracking number (officer/citizen scoped). */
export async function trackByNumber(ctx: RequestContext, trackingNo: string) {
  const appRow = await intakeRepo.findApplicationByTracking(ctx.tenantId, trackingNo);
  if (!appRow) return null;
  if (!isOfficer(ctx) && appRow.citizenId !== ctx.actorId) return null;
  return {
    trackingNo: appRow.trackingNo, applicationId: appRow.id, status: appRow.status,
    channel: appRow.channel, acknowledgedAt: appRow.acknowledgedAt, submittedAt: appRow.submittedAt,
  };
}
