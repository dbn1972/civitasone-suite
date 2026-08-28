import type { RequestContext } from "@civitasone/types";
import { createHash } from "node:crypto";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveDirectionId } from "./domain.js";
import {
  createDirectionBody, type CreateDirectionBody,
  updateComplianceBody, type UpdateComplianceBody,
} from "./validators.js";

export type CreateDirectionResult = { accepted: true; directionId: string };
export type UpdateComplianceResult = { accepted: true; directionId: string };

/**
 * Content-derived disambiguator fed into deriveDirectionId's `seq` slot: a SHA-256
 * hash of the direction's meaningful body fields, truncated to 52 bits (well inside
 * Number.MAX_SAFE_INTEGER). A genuine RETRY of the identical direction (same
 * orderId/direction/responsibleAuthority/dueDate — e.g. after a client-side timeout)
 * hashes to the same seq and so dedupes to the same directionId via the existing
 * onConflictDoNothing path; a direction with DIFFERENT content — even on the same
 * case/order — hashes differently and gets its own id instead of silently
 * overwriting the first (previously this was hardcoded to `1`, so a second
 * legitimate direction vanished — see Bug A).
 */
function directionContentSeq(body: CreateDirectionBody): number {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      orderId: body.orderId ?? null,
      direction: body.direction,
      responsibleAuthority: body.responsibleAuthority ?? null,
      dueDate: body.dueDate ?? null,
    }))
    .digest("hex");
  return Number.parseInt(digest.slice(0, 13), 16);
}

/** Create a compliance direction on a case (§26). Idempotent per
 *  (tenant + case + order + content): an identical resubmission (e.g. a client
 *  retry) dedupes to the same direction; a direction with different content is a
 *  genuinely new one and gets its own id, even on the same case/order. */
export async function createDirection(
  ctx: RequestContext, caseId: string, input: CreateDirectionBody,
): Promise<CreateDirectionResult> {
  const body = createDirectionBody.parse(input);
  const directionId = deriveDirectionId(ctx.tenantId, caseId, body.orderId, directionContentSeq(body));

  await queue.publish(COMMANDS.createDirection, {
    messageId: directionId,
    type: COMMANDS.createDirection,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: directionId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, directionId };
}

/** Record progress / close a compliance direction (§26). messageId is idempotent
 *  per (direction + expectedVersion). */
export async function updateCompliance(
  ctx: RequestContext, directionId: string, input: UpdateComplianceBody,
): Promise<UpdateComplianceResult> {
  const body = updateComplianceBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:compliance-update:${directionId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.updateCompliance, {
    messageId,
    type: COMMANDS.updateCompliance,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { directionId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, directionId };
}
