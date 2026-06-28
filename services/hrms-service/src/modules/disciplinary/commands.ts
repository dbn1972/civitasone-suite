import type { RequestContext } from "@civitasone/types";
import { randomUUID } from "node:crypto";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Proposed-penalty payload routed to eOffice for administrative approval.
 * `penaltyClass` is resolved at the route boundary (penaltyClassOf) so the
 * consumer can record it without re-deriving domain knowledge.
 */
export interface SubmitDisciplinaryForApprovalInput {
  penaltyType: string;
  penaltyClass: "minor" | "major";
  penaltyDate: string;
  penaltyDetail?: string;
  notes?: string;
}

/**
 * Submit a disciplinary case's proposed penalty to eOffice for approval.
 * Mirrors employee/commands.ts `submitTransferForApproval`: rather than
 * imposing the penalty directly, it publishes a command that moves the case to
 * `pending_approval`. The eFile is raised against the case id (source_ref_type
 * "hr_disciplinary"); the decision returns on `hrms.disciplinary.file_decided`
 * and the eoffice-consumer either imposes the penalty (approved) or drops the
 * case (rejected).
 */
export async function submitDisciplinaryForApproval(
  ctx: RequestContext, caseId: string, input: SubmitDisciplinaryForApprovalInput,
): Promise<Accepted> {
  await queue.publish(COMMANDS.disciplinarySubmitApproval, {
    messageId: randomUUID(), type: COMMANDS.disciplinarySubmitApproval,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { ...input, caseId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "disciplinary_case", caseId));
  return { id: caseId, status: "accepted", correlationId: ctx.correlationId };
}
