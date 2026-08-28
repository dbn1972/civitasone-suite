import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
import { assertTransition, assertDifferentApprover } from "./domain.js";
import { getOrderForPrecheck } from "./repo.js";
import { httpError, assertVersionAndTransition } from "../../shared/context.js";
import {
  submitForApprovalBody, type SubmitForApprovalBody,
  approveAndIssueBody, type ApproveAndIssueBody,
  sendBackBody, type SendBackBody,
  recallBody, type RecallBody,
} from "./validators.js";

export type IssuanceResult = { accepted: true; orderId: string };

/**
 * order-issuance commands — write intents for the maker-checker approval +
 * DSC-pronouncement lifecycle. Each `messageId` is deterministic per
 * (order + intent + expectedVersion) so a redelivery of the SAME intent at the
 * SAME version is exactly-once end-to-end (the consumer's markProcessed dedupes).
 *
 * Every command below runs a SYNCHRONOUS pre-check before publishing, reusing
 * the exact same domain functions (assertTransition / assertDifferentApprover)
 * the consumer uses. Without this, a foreseeable rejection -- most seriously a
 * self-approval attempt on approveAndIssue -- returned 202 {accepted:true} and
 * then silently dead-lettered in the consumer with ZERO signal back to the
 * caller: the frontend's ApproveIssueDialog showed "Approval & issuance
 * submitted" for an order that was never actually approved. Confirmed live
 * during the deep-verification pass that produced this fix. The consumer's
 * identical checks remain the authoritative backstop for the race window
 * between this read and the eventual write. The read is via
 * getOrderForPrecheck (this module's own repo, uncached) rather than the
 * `order` module's cached getOrderById, so a stale cache entry can't make
 * this check wrongly pass or wrongly reject.
 */

async function loadOrderForPrecheck(tenantId: string, orderId: string) {
  const current = await getOrderForPrecheck(tenantId, orderId);
  if (!current) throw httpError("ORDER_NOT_FOUND", `Order not found: ${orderId}`);
  return current;
}

/** Submit a drafted order for approval (draft → pending_approval). */
export async function submitForApproval(
  ctx: RequestContext, orderId: string, input: SubmitForApprovalBody,
): Promise<IssuanceResult> {
  const body = submitForApprovalBody.parse(input);

  const current = await loadOrderForPrecheck(ctx.tenantId, orderId);
  assertVersionAndTransition(current, body.expectedVersion, "pending_approval", assertTransition, {
    versionConflict: "ORDER_VERSION_CONFLICT",
    invalidTransition: "ORDER_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:order-submit:${orderId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.submitOrderForApproval, {
    messageId,
    type: COMMANDS.submitOrderForApproval,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { orderId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, orderId };
}

/**
 * Approve + issue (pronounce) an order (pending_approval → issued).
 *
 * §35.5 — issuance is a HUMAN, DSC-signed act. MAKER-CHECKER (approver ≠ maker)
 * is checked HERE, synchronously, before publish -- not just in the consumer
 * -- so a self-approval attempt gets an immediate 403 instead of a fake 202.
 * It runs UNCONDITIONALLY, even when the order is already `issued` (an
 * idempotent-retry no-op for the transition/version checks below): a repeat
 * self-approval attempt against an already-issued order must still surface
 * as a rejected maker-checker violation, not silently succeed just because
 * nothing would have changed anyway. The route restricts this to the
 * checker/bench roles.
 */
export async function approveAndIssue(
  ctx: RequestContext, orderId: string, input: ApproveAndIssueBody,
): Promise<IssuanceResult> {
  const body = approveAndIssueBody.parse(input);

  const current = await loadOrderForPrecheck(ctx.tenantId, orderId);
  try {
    assertDifferentApprover(current.createdBy ?? current.signedBy, ctx.actorId);
  } catch (e) {
    throw httpError("MAKER_CHECKER_VIOLATION", (e as Error).message);
  }
  assertVersionAndTransition(current, body.expectedVersion, "issued", assertTransition, {
    versionConflict: "ORDER_VERSION_CONFLICT",
    invalidTransition: "ORDER_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:order-issue:${orderId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.approveAndIssueOrder, {
    messageId,
    type: COMMANDS.approveAndIssueOrder,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { orderId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, orderId };
}

/** Send a pending order back to its maker for revision (pending_approval → draft). */
export async function sendBack(
  ctx: RequestContext, orderId: string, input: SendBackBody,
): Promise<IssuanceResult> {
  const body = sendBackBody.parse(input);

  const current = await loadOrderForPrecheck(ctx.tenantId, orderId);
  assertVersionAndTransition(current, body.expectedVersion, "draft", assertTransition, {
    versionConflict: "ORDER_VERSION_CONFLICT",
    invalidTransition: "ORDER_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:order-sendback:${orderId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.sendBackOrder, {
    messageId,
    type: COMMANDS.sendBackOrder,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { orderId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, orderId };
}

/** Recall an already-issued order (issued → recalled). */
export async function recall(
  ctx: RequestContext, orderId: string, input: RecallBody,
): Promise<IssuanceResult> {
  const body = recallBody.parse(input);

  const current = await loadOrderForPrecheck(ctx.tenantId, orderId);
  assertVersionAndTransition(current, body.expectedVersion, "recalled", assertTransition, {
    versionConflict: "ORDER_VERSION_CONFLICT",
    invalidTransition: "ORDER_INVALID_TRANSITION",
  });

  const messageId = deterministicId(
    COURT_NAMESPACE,
    `${ctx.tenantId}:order-recall:${orderId}:${body.expectedVersion}`,
  );

  await queue.publish(COMMANDS.recallOrder, {
    messageId,
    type: COMMANDS.recallOrder,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { orderId, tenantId: ctx.tenantId, ...body },
  });

  return { accepted: true, orderId };
}
