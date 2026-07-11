import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deterministicId, COURT_NAMESPACE } from "../court-registry/domain.js";
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
 */

/** Submit a drafted order for approval (draft → pending_approval). */
export async function submitForApproval(
  ctx: RequestContext, orderId: string, input: SubmitForApprovalBody,
): Promise<IssuanceResult> {
  const body = submitForApprovalBody.parse(input);
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
 * §35.5 — issuance is a HUMAN, DSC-signed act. The consumer HARD-enforces
 * maker-checker (approver ≠ maker); an AI / service actor must never reach this
 * command. The route restricts it to the checker/bench roles.
 */
export async function approveAndIssue(
  ctx: RequestContext, orderId: string, input: ApproveAndIssueBody,
): Promise<IssuanceResult> {
  const body = approveAndIssueBody.parse(input);
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
