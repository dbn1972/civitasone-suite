import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deriveOrderId } from "./domain.js";
import { recordOrderBody, type RecordOrderBody } from "./validators.js";

export type RecordOrderResult = { accepted: true; orderId: string };

/** Record (draft) an order on a case (§23). The order id is deterministic per
 *  (case + orderType + a fresh idempotency key) so the publish→consume path is
 *  exactly-once for this intent. */
export async function recordOrder(
  ctx: RequestContext, caseId: string, input: RecordOrderBody,
): Promise<RecordOrderResult> {
  const body = recordOrderBody.parse(input);
  const orderId = deriveOrderId(ctx.tenantId, caseId, body.orderType, randomUUID());

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
