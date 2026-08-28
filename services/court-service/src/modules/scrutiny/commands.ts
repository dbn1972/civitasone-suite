import type { RequestContext } from "@civitasone/types";
import { createHash } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveScrutinyId, deriveDefectId } from "./domain.js";
import {
  recordScrutinyBody, type RecordScrutinyBody,
  raiseDefectBody, type RaiseDefectBody,
  resolveDefectBody, type ResolveDefectBody,
  resolveScrutinyBody, type ResolveScrutinyBody,
} from "./validators.js";

export type RecordScrutinyResult = { accepted: true; scrutinyId: string };
export type RaiseDefectResult = { accepted: true; defectId: string };
export type ResolveDefectResult = { accepted: true; defectId: string };
export type ResolveScrutinyResult = { accepted: true; scrutinyId: string };

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

/**
 * Content-derived disambiguator fed into deriveDefectId's `seq` slot — same shape as
 * directionContentSeq in compliance/commands.ts: a SHA-256 hash of the defect's
 * meaningful body fields, truncated to 52 bits (well inside Number.MAX_SAFE_INTEGER).
 * A genuine RETRY of the identical defect (same category/description/severity/
 * rectificationDeadline — e.g. after a client-side timeout) hashes to the same seq
 * and so dedupes to the same defectId; a defect with DIFFERENT content — even in the
 * SAME category on the same case — hashes differently and gets its own id instead of
 * silently overwriting the first (previously this was hardcoded to `1`, so a second
 * legitimate defect in the same category vanished — see Bug A).
 */
function defectContentSeq(body: RaiseDefectBody): number {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      category: body.category.trim().toLowerCase(),
      description: body.description,
      severity: body.severity ?? null,
      rectificationDeadline: body.rectificationDeadline ?? null,
    }))
    .digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16);
}

/** Raise a defect against a case (§13). Idempotent per (case + category + content):
 *  an identical resubmission (e.g. a client retry) dedupes to the same defect; a
 *  defect with different content is a genuinely new one and gets its own id, even in
 *  the same category. */
export async function raiseDefect(
  ctx: RequestContext, caseId: string, input: RaiseDefectBody,
): Promise<RaiseDefectResult> {
  const body = raiseDefectBody.parse(input);
  const defectId = deriveDefectId(ctx.tenantId, caseId, body.category, defectContentSeq(body));
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

/** Resolve a scrutiny (§13). messageId is idempotent per (scrutiny + expectedVersion). */
export async function resolveScrutiny(
  ctx: RequestContext, scrutinyId: string, input: ResolveScrutinyBody,
): Promise<ResolveScrutinyResult> {
  const body = resolveScrutinyBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:scrutiny-resolve:${scrutinyId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.resolveScrutiny, {
    messageId,
    type: COMMANDS.resolveScrutiny,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { scrutinyId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, scrutinyId };
}
