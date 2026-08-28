import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveEvidenceId, submissionDisambiguator } from "./domain.js";
import {
  submitEvidenceBody, type SubmitEvidenceBody,
  ruleEvidenceBody, type RuleEvidenceBody,
} from "./validators.js";

export type SubmitEvidenceResult = { accepted: true; evidenceId: string };
export type RuleEvidenceResult = { accepted: true; evidenceId: string };

/** Submit a piece of evidence/exhibit (§22). Idempotent per (case + exhibit content). */
export async function submitEvidence(
  ctx: RequestContext, caseId: string, input: SubmitEvidenceBody,
): Promise<SubmitEvidenceResult> {
  const body = submitEvidenceBody.parse(input);
  const evidenceId = deriveEvidenceId(
    ctx.tenantId, caseId, body.exhibitNumber ?? body.title, submissionDisambiguator(body),
  );

  await queue.publish(COMMANDS.submitEvidence, {
    messageId: evidenceId,
    type: COMMANDS.submitEvidence,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: evidenceId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, evidenceId };
}

/** Rule on an exhibit (§22). messageId is idempotent per (evidence + expectedVersion). */
export async function ruleOnEvidence(
  ctx: RequestContext, evidenceId: string, input: RuleEvidenceBody,
): Promise<RuleEvidenceResult> {
  const body = ruleEvidenceBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:evidence-rule:${evidenceId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.ruleOnEvidence, {
    messageId,
    type: COMMANDS.ruleOnEvidence,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { evidenceId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, evidenceId };
}
