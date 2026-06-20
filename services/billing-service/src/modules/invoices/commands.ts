import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { getSubscription } from "../subscriptions/queries.js";
import { getPlan } from "../plans/queries.js";
import { getUsage } from "../usage/queries.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function generateInvoice(ctx: RequestContext, tenantId: string, periodMonth: string): Promise<Accepted> {
  const id = randomUUID();
  const sub = await getSubscription(tenantId);
  const plan = sub ? await getPlan(sub.planId) : null;
  const usage = await getUsage(tenantId, periodMonth);
  const govtExempt = plan?.govtExempt ?? false;
  let totalMinor = 0;
  if (plan && usage?.metrics) {
    for (const m of usage.metrics) {
      totalMinor += Number(m.total) * Number(plan.priceMinor) / 100;
    }
  }

  await queue.publish(COMMANDS.invoiceGenerate, {
    messageId: id, type: COMMANDS.invoiceGenerate, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId, periodMonth, govtExempt, totalMinor },
  });
  await cache.invalidate(cache.makeKey(tenantId, "invoices", tenantId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function issueInvoice(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.invoiceIssue, {
    type: COMMANDS.invoiceIssue, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function payInvoice(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.invoicePay, {
    type: COMMANDS.invoicePay, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
