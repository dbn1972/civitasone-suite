import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveScrutinyId, deriveDefectId } from "./domain.js";
import {
  recordScrutinyBody, type RecordScrutinyBody,
  raiseDefectBody, type RaiseDefectBody,
  resolveDefectBody, type ResolveDefectBody,
} from "./validators.js";

export type RecordScrutinyResult = { accepted: true; scrutinyId: string };
export type RaiseDefectResult = { accepted: true; defectId: string };
export type ResolveDefectResult = { accepted: true; defectId: string };

/** Record the registry scrutiny of a case (§13). Idempotent per (case). */
export async function recordScrutiny(
  ctx: RequestContext, caseId: string, input: RecordScrutinyBody,
): Promise<RecordScrutinyResult> {
  const body = recordScrutinyBody.parse(input);
  const scrutinyId = deriveScrutinyId(ctx.tenantId, caseId);

  await queue.publish(COMMANDS.recordScrutiny, {
    messageId: scrutinyId,
    type: COMMANDS.recordScrutiny,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: scrutinyId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, scrutinyId };
}

/** Raise a defect against a case (§13). Idempotent per (case + category): a defect
 *  is one-per-category so re-submitting the SAME category on a case is a no-op. */
export async function raiseDefect(
  ctx: RequestContext, caseId: string, input: RaiseDefectBody,
): Promise<RaiseDefectResult> {
  const body = raiseDefectBody.parse(input);
  const defectId = deriveDefectId(ctx.tenantId, caseId, body.category, 1);
  const scrutinyId = deriveScrutinyId(ctx.tenantId, caseId);

  await queue.publish(COMMANDS.raiseDefect, {
    messageId: defectId,
    type: COMMANDS.raiseDefect,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: defectId, caseId, scrutinyId, tenantId: ctx.tenantId },
  });

  return { accepted: true, defectId };
}

/** Resolve a raised defect (§13). messageId is idempotent per (defect + expectedVersion). */
export async function resolveDefect(
  ctx: RequestContext, defectId: string, input: ResolveDefectBody,
): Promise<ResolveDefectResult> {
  const body = resolveDefectBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:defect-resolve:${defectId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.resolveDefect, {
    messageId,
    type: COMMANDS.resolveDefect,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { defectId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, defectId };
}
