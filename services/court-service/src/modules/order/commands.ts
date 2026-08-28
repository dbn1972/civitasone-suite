import { createHash } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deriveOrderId } from "./domain.js";
import { recordOrderBody, type RecordOrderBody } from "./validators.js";

export type RecordOrderResult = { accepted: true; orderId: string };

/**
 * Record (draft) an order on a case (§23). The order id is deterministic per
 * (case + orderType + idempotencyKey).
 *
 * idempotencyKey is a SHA-256 content hash of the order's meaningful fields,
 * NOT a fresh randomUUID() per call: a fresh random key on every call means
 * NOTHING ever dedupes -- a client retry after a network timeout (or a
 * double-click) creates a second, distinct draft order rather than being
 * recognised as the same intent (the identical bug this service's
 * filing/notice modules had, fixed the same way; see filing/commands.ts's
 * hashFilingContent for the fuller writeup of the tradeoff: two genuinely
 * distinct orders with byte-identical hearingId/orderType/orderText/
 * orderDate would also collide, which is judged the lesser risk versus
 * silently duplicating a court order draft on every retry).
 */
export async function recordOrder(
  ctx: RequestContext, caseId: string, input: RecordOrderBody,
): Promise<RecordOrderResult> {
  const body = recordOrderBody.parse(input);
  const idempotencyKey = createHash("sha256").update(JSON.stringify({
    hearingId: body.hearingId ?? null,
    orderType: body.orderType,
    orderText: body.orderText,
    orderDate: body.orderDate ?? null,
  })).digest("hex");
  const orderId = deriveOrderId(ctx.tenantId, caseId, body.orderType, idempotencyKey);

  await queue.publish(COMMANDS.recordOrder, {
    messageId: orderId,
    type: COMMANDS.recordOrder,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...body, id: orderId, caseId, tenantId: ctx.tenantId },
  });

  return { accepted: true, orderId };
}
