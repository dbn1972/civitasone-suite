import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { updateCaseStatusBody, type UpdateCaseStatusBody } from "./validators.js";

export type UpdateCaseStatusResult = { accepted: true; caseId: string };

/**
 * Request a case-status transition (§11). The messageId is deterministic on
 * (caseId + toStatus + expectedVersion) so a duplicate submit of the SAME
 * transition is a true no-op (markProcessed dedupe), while a genuinely new
 * transition (new expectedVersion) is a distinct message.
 */
export async function updateCaseStatus(
  ctx: RequestContext, caseId: string, input: UpdateCaseStatusBody,
): Promise<UpdateCaseStatusResult> {
  const body = updateCaseStatusBody.parse(input);
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
