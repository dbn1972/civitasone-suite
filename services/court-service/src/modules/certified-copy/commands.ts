import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import * as repo from "./repo.js";
import { deriveCopyId, assertTransition, assertReceiptMatchesFee, parseReceiptMinor } from "./domain.js";
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

/**
 * Transition a certified copy (§30). messageId is idempotent per (copy + expectedVersion).
 *
 * §30 honest-response guarantee: a synchronous pre-check against the copy's
 * CURRENT row runs here, BEFORE publishing, so the common failure cases — an
 * illegal transition (e.g. `fee_paid` on an already-terminal copy), a stale
 * `expectedVersion`, or a `receiptMinor` that doesn't match the server-computed
 * fee — get an immediate, honest 4xx instead of a `202 {accepted:true}` that
 * silently dead-letters in the consumer. This mirrors consumer.ts's own checks
 * EXACTLY (same functions, same order, same "already at target ⇒ no-op"
 * idempotency shortcut) so a legitimate idempotent retry still succeeds here
 * rather than being newly rejected. The consumer's checks remain the
 * authoritative backstop for the rare race window between this read and its
 * own transactional read.
 */
export async function transitionCopy(
  ctx: RequestContext, copyId: string, input: TransitionCopyBody,
): Promise<TransitionCopyResult> {
  const body = transitionCopyBody.parse(input);

  const current = await repo.getCopy(ctx.tenantId, copyId);
  if (!current) {
    throw new HttpError(404, "COPY_NOT_FOUND", `certified copy ${copyId} not found`);
  }

  // Already at target: redelivery/idempotent-retry-safe no-op, same as the
  // consumer — skip the version/transition/fee checks below entirely.
  if (current.status !== body.target) {
    if (current.version !== body.expectedVersion) {
      throw new HttpError(
        409,
        "VERSION_CONFLICT",
        `certified copy ${copyId} expected v${body.expectedVersion}, found v${current.version}`,
      );
    }

    try {
      assertTransition(current.status, body.target);
    } catch (e) {
      throw new HttpError(422, "INVALID_COPY_TRANSITION", (e as Error).message);
    }

    if (body.target === "fee_paid") {
      let receiptMinor: bigint;
      try {
        receiptMinor = parseReceiptMinor(body.receiptMinor);
      } catch (e) {
        throw new HttpError(422, "INVALID_RECEIPT_AMOUNT", (e as Error).message);
      }
      try {
        assertReceiptMatchesFee(current.feeMinor, receiptMinor);
      } catch (e) {
        throw new HttpError(422, "RECEIPT_AMOUNT_MISMATCH", (e as Error).message);
      }
    }
  }

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
