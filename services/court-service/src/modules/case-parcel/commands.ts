import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveParcelId, normalizeSurvey } from "./domain.js";
import {
  addParcelBody, type AddParcelBody,
  updateParcelBody, type UpdateParcelBody,
} from "./validators.js";

export type AddParcelResult = { accepted: true; parcelId: string };
export type UpdateParcelResult = { accepted: true; parcelId: string };

/**
 * Attach a parcel to a case (revenue-court domain). Idempotent per
 * (case + normalized survey + normalized khasra) via `deriveParcelId`, so
 * re-adding the same parcel is an end-to-end no-op.
 */
export async function addParcel(
  ctx: RequestContext, caseId: string, input: AddParcelBody,
): Promise<AddParcelResult> {
  const body = addParcelBody.parse(input);
  const surveyNumber = normalizeSurvey(body.surveyNumber);
  const parcelId = deriveParcelId(ctx.tenantId, caseId, body.surveyNumber, body.khasraNumber);

  await queue.publish(COMMANDS.addParcel, {
    messageId: parcelId,
    type: COMMANDS.addParcel,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, surveyNumber, id: parcelId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, parcelId };
}

/**
 * Update / soft-detach a parcel. messageId is deterministic per
 * (parcel + expectedVersion) so a redelivery of the same intent is idempotent.
 */
export async function updateParcel(
  ctx: RequestContext, parcelId: string, input: UpdateParcelBody,
): Promise<UpdateParcelResult> {
  const body = updateParcelBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:parcel-update:${parcelId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.updateParcel, {
    messageId,
    type: COMMANDS.updateParcel,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { parcelId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, parcelId };
}
