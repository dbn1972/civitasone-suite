import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { updateCaseStatusBody, type UpdateCaseStatusBody } from "./validators.js";
import { assertTransition } from "./domain.js";
import { getCaseById } from "../case-registry/repo.js";
import { HttpError } from "../../shared/context.js";

export type UpdateCaseStatusResult = { accepted: true; caseId: string };

/**
 * Request a case-status transition (§11). The messageId is deterministic on
 * (caseId + toStatus + expectedVersion) so a duplicate submit of the SAME
 * transition is a true no-op (markProcessed dedupe), while a genuinely new
 * transition (new expectedVersion) is a distinct message.
 *
 * A synchronous pre-check runs BEFORE publishing, reusing the exact same
 * assertTransition() the consumer uses: without it, an illegal transition
 * (e.g. skipping straight from 'registered' to 'disposed') returns 202
 * {accepted:true} and then silently dead-letters in the consumer with zero
 * signal back to the caller -- confirmed live during the deep-verification
 * pass that produced this fix. The consumer's identical check remains the
 * authoritative backstop for the race window between this read and the
 * eventual write (e.g. a concurrent transition landing in between).
 */
export async function updateCaseStatus(
  ctx: RequestContext, caseId: string, input: UpdateCaseStatusBody,
): Promise<UpdateCaseStatusResult> {
  const body = updateCaseStatusBody.parse(input);

  const current = await getCaseById(ctx.tenantId, caseId);
  if (!current) throw new HttpError(404, "CASE_NOT_FOUND", `Case not found: ${caseId}`);
  if (current.status !== body.toStatus) {
    // Mirrors the consumer's own order: version check, then transition legality.
    if (current.version !== body.expectedVersion) {
      throw new HttpError(
        409, "VERSION_CONFLICT",
        `Expected version ${body.expectedVersion}, found ${current.version}`,
      );
    }
    try {
      assertTransition(current.status, body.toStatus);
    } catch (e) {
      throw new HttpError(409, "ILLEGAL_TRANSITION", (e as Error).message);
    }
  }

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:case-status:${caseId}:${body.toStatus}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.updateCaseStatus, {
    messageId,
    type: COMMANDS.updateCaseStatus,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { caseId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, caseId };
}
