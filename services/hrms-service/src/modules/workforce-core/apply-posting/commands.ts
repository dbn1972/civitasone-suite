/**
 * applyPosting — command publisher (SmartTransfer OS, ST-M01-09).
 *
 * Builds the `hrms.posting.apply` command (house rule 1). The messageId is
 * DETERMINISTIC on the ORDER id — `posting.apply:<orderId>` — never the
 * employee or post id, so a redelivery (or a double-submitted order) is dropped
 * by markProcessed in the consumer and the posting is applied exactly once per
 * order (idempotent on the order id). A client x-idempotency-key is ignored:
 * the order id is the only idempotency key.
 */
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../../shared/infra.js";
import { COMMANDS } from "../../../topics.js";
import { IN_SERVICE_PRODUCER } from "./producer.js";
import type { ApplyPostingBody } from "./validators.js";

export type Accepted = {
  /** Standard 202 envelope key (acceptedResponseSchema) — the order id. */
  id: string;
  orderId: string;
  status: string;
  correlationId: string;
  data: { id: string; orderId: string };
};

export async function applyPosting(
  ctx: RequestContext,
  body: ApplyPostingBody,
): Promise<Accepted> {
  const messageId = idempotentId({
    // Always derived from the ORDER id. A client x-idempotency-key is
    // deliberately ignored: honouring it would let one order be applied twice
    // under two different keys.
    idempotencyKey: `posting.apply:${body.orderId}`,
    tenantId: ctx.tenantId,
  });
  await queue.publish(COMMANDS.postingApply, {
    messageId,
    type: COMMANDS.postingApply,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      orderId: body.orderId,
      tenantId: ctx.tenantId,
      employeeId: body.employeeId,
      postId: body.postId,
      effectiveDate: body.effectiveDate,
      chargeType: body.chargeType,
      orderNumber: body.orderNumber,
      // ST-M01-15: the producing service, carried so the consumer can enforce
      // the frozen contract's producer ACL (D-ST-19 / D-ST-10). This is the
      // hrms-service in-service HTTP affordance — a trusted self-producer that
      // runs the SAME path SmartTransfer drives (routes.ts). Same `.passthrough`
      // tolerant-reader shape as the `sourceService` convention, so it does not
      // change the frozen `hrms.posting.apply` schema (D-18).
      producer: IN_SERVICE_PRODUCER,
      ...(body.approvedBy ? { approvedBy: body.approvedBy } : {}),
    },
  });
  return {
    id: body.orderId,
    orderId: body.orderId,
    status: "accepted",
    correlationId: ctx.correlationId,
    data: { id: body.orderId, orderId: body.orderId },
  };
}
