import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { HttpError } from "../../shared/context.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import * as repo from "./repo.js";
import { deriveCopyId, assertLegalCopyTransition } from "./domain.js";
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
 * silently dead-letters in the consumer. The check itself
 * (`assertLegalCopyTransition` in domain.ts) is the SAME function the
 * consumer calls for its own authoritative check, so the two can never
 * silently drift apart on a future edit to either one — the consumer's
 * transactional read remains the backstop for the rare race window between
 * that read and this one (two concurrent requests can both pass this
 * pre-check before either write commits; the consumer's version check is
 * what ultimately resolves that, dead-lettering the loser honestly).
 *
 * This read is intentionally NOT cache-backed (unlike a query-handler GET
 * route): it gates a correctness-critical decision made at write time, where
 * a stale cached row could give a dishonest answer — the exact failure mode
 * this fix exists to close. `getCopyForUpdate` in consumer.ts is uncached
 * for the same reason.
 */
export async function transitionCopy(
  ctx: RequestContext, copyId: string, input: TransitionCopyBody,
): Promise<TransitionCopyResult> {
  const body = transitionCopyBody.parse(input);

  const current = await repo.getCopy(ctx.tenantId, copyId);
  if (!current) {
    throw new HttpError(404, "COPY_NOT_FOUND", `certified copy ${copyId} not found`);
  }

  try {
    assertLegalCopyTransition({
      copyId,
      currentStatus: current.status,
      currentVersion: current.version,
      currentFeeMinor: current.feeMinor,
      target: body.target,
      expectedVersion: body.expectedVersion,
      ...(body.receiptMinor !== undefined ? { receiptMinor: body.receiptMinor } : {}),
    });
  } catch (e) {
    const message = (e as Error).message;
    const colonIdx = message.indexOf(":");
    const code = colonIdx === -1 ? message : message.slice(0, colonIdx);
    throw new HttpError(code === "VERSION_CONFLICT" ? 409 : 422, code, message);
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
