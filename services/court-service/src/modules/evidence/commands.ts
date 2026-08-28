import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveEvidenceId, submissionDisambiguator, assertTransition } from "./domain.js";
import { getEvidenceForPrecheck } from "./repo.js";
import { httpError, assertVersionAndTransition } from "../../shared/context.js";
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

/**
 * Rule on an exhibit (§22). messageId is idempotent per (evidence + ruling +
 * expectedVersion) -- ruling is part of the key so two DIFFERENT legal
 * rulings submitted at the same expectedVersion can't collide onto one
 * messageId (mirrors appeal/commands.ts's decideAppeal).
 *
 * Synchronous pre-check mirrors the consumer's own checks exactly, so an
 * illegal ruling (e.g. re-ruling an already-admitted exhibit) is an
 * immediate, honest 4xx instead of a 202 that silently dead-letters.
 */
export async function ruleOnEvidence(
  ctx: RequestContext, evidenceId: string, input: RuleEvidenceBody,
): Promise<RuleEvidenceResult> {
  const body = ruleEvidenceBody.parse(input);

  const current = await getEvidenceForPrecheck(ctx.tenantId, evidenceId);
  if (!current) throw httpError("EVIDENCE_NOT_FOUND", `Evidence not found: ${evidenceId}`);
  assertVersionAndTransition(current, body.expectedVersion, body.ruling, assertTransition, {
    versionConflict: "EVIDENCE_VERSION_CONFLICT",
    invalidTransition: "EVIDENCE_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:evidence-rule:${evidenceId}:${body.ruling}:${body.expectedVersion}`,
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
