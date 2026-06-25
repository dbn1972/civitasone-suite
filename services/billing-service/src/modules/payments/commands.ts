import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { RecordPaymentBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/**
 * Record a payment receipt against a bill. The id is derived from the client
 * idempotency key (when present) so a double-submitted receipt dedupes at the
 * consumer; the consumer validates the bill is payable and the amount is within
 * outstanding, then advances the bill to partially_paid / paid.
 */
export async function recordPayment(ctx: RequestContext, body: RecordPaymentBody): Promise<Accepted> {
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.paymentRecord, {
    messageId: id, type: COMMANDS.paymentRecord, tenantId: body.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: body.tenantId, invoiceId: body.invoiceId,
      amountMinor: body.amountMinor, method: body.method, gateway: body.gateway,
      ...(body.reference ? { reference: body.reference } : {}),
    },
  });
  await cache.invalidateResource(body.tenantId, "invoices");
  await cache.invalidate(cache.makeKey(body.tenantId, "invoice", body.invoiceId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
