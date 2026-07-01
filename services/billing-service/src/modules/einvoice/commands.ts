import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Publish a command to generate an e-invoice (IRN) for an existing billing invoice. */
export async function generateEInvoice(ctx: RequestContext, invoiceId: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.einvoiceGenerate, {
    messageId: id,
    type: COMMANDS.einvoiceGenerate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, invoiceId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "einvoice", invoiceId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Publish a command to cancel an existing IRN (within 24h per NIC rules). */
export async function cancelEInvoice(ctx: RequestContext, invoiceId: string, reason: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.einvoiceCancel, {
    messageId: id,
    type: COMMANDS.einvoiceCancel,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, invoiceId, tenantId: ctx.tenantId, reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "einvoice", invoiceId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
