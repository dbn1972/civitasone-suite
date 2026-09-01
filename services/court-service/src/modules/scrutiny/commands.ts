import type { RequestContext } from "@civitasone/types";
import { createHash } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveScrutinyId, deriveDefectId, assertDefectTransition, assertScrutinyTransition } from "./domain.js";
import { getDefectForPrecheck, getScrutinyForPrecheck } from "./repo.js";

async function loadDefectForPrecheck(tenantId: string, defectId: string) {
  const current = await getDefectForPrecheck(tenantId, defectId);
  if (!current) throw httpError("DEFECT_NOT_FOUND", `Defect not found: ${defectId}`);
  return current;
}

async function loadScrutinyForPrecheck(tenantId: string, scrutinyId: string) {
  const current = await getScrutinyForPrecheck(tenantId, scrutinyId);
  if (!current) throw httpError("SCRUTINY_NOT_FOUND", `Scrutiny not found: ${scrutinyId}`);
  return current;
}
import { httpError, assertVersionAndTransition } from "../../shared/context.js";
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

/**
 * Resolve a raised defect (§13). messageId is idempotent per (defect +
 * resolution + expectedVersion) -- resolution is part of the key so two
 * DIFFERENT legal resolutions submitted at the same expectedVersion can't
 * collide onto one messageId (mirrors appeal/commands.ts's decideAppeal).
 *
 * Synchronous pre-check mirrors the consumer's own checks exactly, so an
 * illegal resolution (e.g. re-resolving an already-rectified defect) is an
 * immediate, honest 4xx instead of a 202 that silently dead-letters.
 */
export async function resolveDefect(
  ctx: RequestContext, defectId: string, input: ResolveDefectBody,
): Promise<ResolveDefectResult> {
  const body = resolveDefectBody.parse(input);

  const current = await loadDefectForPrecheck(ctx.tenantId, defectId);
  assertVersionAndTransition(current, body.expectedVersion, body.resolution, assertDefectTransition, {
    versionConflict: "DEFECT_VERSION_CONFLICT",
    invalidTransition: "DEFECT_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:defect-resolve:${defectId}:${body.resolution}:${body.expectedVersion}`,
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

/**
 * Resolve a scrutiny (§13). messageId is idempotent per (scrutiny + status +
 * expectedVersion) -- status is part of the key for the same reason as
 * resolveDefect above.
 *
 * Synchronous pre-check mirrors the consumer's own checks exactly, so an
 * illegal transition is an immediate, honest 4xx instead of a 202 that
 * silently dead-letters.
 */
export async function resolveScrutiny(
  ctx: RequestContext, scrutinyId: string, input: ResolveScrutinyBody,
): Promise<ResolveScrutinyResult> {
  const body = resolveScrutinyBody.parse(input);

  const current = await loadScrutinyForPrecheck(ctx.tenantId, scrutinyId);
  assertVersionAndTransition(current, body.expectedVersion, body.status, assertScrutinyTransition, {
    versionConflict: "SCRUTINY_VERSION_CONFLICT",
    invalidTransition: "SCRUTINY_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:scrutiny-resolve:${scrutinyId}:${body.status}:${body.expectedVersion}`,
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
