import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { deriveCopyId } from "./domain.js";
import {
  requestCopyBody, type RequestCopyBody,
  transitionCopyBody, type TransitionCopyBody,
} from "./validators.js";

export type RequestCopyResult    = { accepted: true; copyId: string };
export type TransitionCopyResult = { accepted: true; copyId: string };

/**
 * Apply for a certified copy (§30). Idempotent per (case + requester + doc ref /
 * order). The applicant name (PII) travels ONLY in the command payload; the
 * consumer encrypts it at rest via the encryptedText column — it is never logged
 * or emitted in an event/audit payload.
 */
export async function requestCopy(
  ctx: RequestContext, caseId: string, input: RequestCopyBody,
): Promise<RequestCopyResult> {
  const body = requestCopyBody.parse(input);
  const seqOrDocRef = body.documentRef ?? body.orderId ?? caseId;
  const copyId = deriveCopyId(ctx.tenantId, caseId, ctx.actorId, seqOrDocRef);

  await queue.publish(COMMANDS.requestCertifiedCopy, {
    messageId: copyId,
    type: COMMANDS.requestCertifiedCopy,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: copyId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, copyId };
}

/** Transition a certified copy (§30). messageId is idempotent per (copy + expectedVersion). */
export async function transitionCopy(
  ctx: RequestContext, copyId: string, input: TransitionCopyBody,
): Promise<TransitionCopyResult> {
  const body = transitionCopyBody.parse(input);
  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:certified-copy-transition:${copyId}:${body.target}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.transitionCertifiedCopy, {
    messageId,
    type: COMMANDS.transitionCertifiedCopy,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { copyId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, copyId };
}
