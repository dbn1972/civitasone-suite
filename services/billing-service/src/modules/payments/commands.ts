import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordPayment(ctx: RequestContext, tenantId: string, invoiceId: string, amountMinor: number, gateway: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.paymentRecord, {
    messageId: id, type: COMMANDS.paymentRecord, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId, invoiceId, amountMinor, gateway },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
