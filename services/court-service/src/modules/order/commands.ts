import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { deriveOrderId, hashOrderContent } from "./domain.js";
import { recordOrderBody, type RecordOrderBody } from "./validators.js";

export type RecordOrderResult = { accepted: true; orderId: string };

/** Record (draft) an order on a case (§23). The order id's disambiguator
 *  PREFERS the caller's own x-idempotency-key when supplied
 *  (RequestContext.idempotencyKey, via idempotentId() -- already wired to the
 *  HTTP layer, mirroring filing/commands.ts's submitFiling): that lets a
 *  caller submit two genuinely distinct, content-identical orders on purpose
 *  (a fresh key each time) while a resent key still dedupes. With no key
 *  supplied, it FALLS BACK to hashOrderContent (a content hash of the
 *  submitted fields) rather than a fresh random value, so an identical
 *  resubmission -- a client double-click or a network-timeout retry --
 *  still reuses the same id and dedupes via markProcessed/onConflictDoNothing
 *  instead of creating a second, distinct draft order row. See
 *  hashOrderContent's doc comment (domain.ts) for the accepted tradeoff of
 *  that fallback path. */
export async function recordOrder(
  ctx: RequestContext, caseId: string, input: RecordOrderBody,
): Promise<RecordOrderResult> {
  const body = recordOrderBody.parse(input);
  const idempotencyKey = ctx.idempotencyKey
    ? idempotentId(ctx)
    : hashOrderContent(body.hearingId, body.orderType, body.orderText, body.orderDate);
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
