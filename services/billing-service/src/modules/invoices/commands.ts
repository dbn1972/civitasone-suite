import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import { computeTotals, requiresApproval, type LineItemInput } from "./domain.js";
import { getSubscription } from "../subscriptions/queries.js";
import { getPlan } from "../plans/queries.js";
import { getUsage } from "../usage/queries.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Auto-generate a usage bill from the tenant's plan + recorded usage (legacy path). */
export async function generateInvoice(ctx: RequestContext, tenantId: string, periodMonth: string): Promise<Accepted> {
  const id = randomUUID();
  const sub = await getSubscription(tenantId);
  const plan = sub ? await getPlan(sub.planId) : null;
  const usage = await getUsage(tenantId, periodMonth);
  const govtExempt = plan?.govtExempt ?? false;
  let totalMinor = 0n; // B1: integer paise, no /100 under-bill
  if (plan && usage?.metrics) {
    for (const m of usage.metrics) {
      totalMinor += BigInt(Math.round(Number(m.total))) * BigInt(plan.priceMinor);
    }
  }

  await queue.publish(COMMANDS.invoiceGenerate, {
    messageId: id, type: COMMANDS.invoiceGenerate, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId, periodMonth, govtExempt, totalMinor: totalMinor.toString() },
  });
  await cache.invalidateResource(tenantId, "invoices");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Create a draft bill from caller-supplied line items (incl. tax/charge lines). */
export async function createInvoice(
  ctx: RequestContext,
  tenantId: string,
  periodMonth: string,
  items: LineItemInput[],
): Promise<Accepted> {
  const id = idempotentId(ctx); // double-submit dedupe
  const totals = computeTotals(items);
  await queue.publish(COMMANDS.invoiceCreate, {
    messageId: id, type: COMMANDS.invoiceCreate, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId, periodMonth, items,
      taxMinor: totals.taxMinor.toString(),
      chargesMinor: totals.chargesMinor.toString(),
      totalMinor: totals.totalMinor.toString(),
    },
  });
  await cache.invalidateResource(tenantId, "invoices");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Request to issue a draft bill. Maker-checker: significant-value bills route to
 * a pending approval (a different actor must approve); below threshold the issue
 * executes immediately. The consumer enforces the maker!=checker rule and the
 * draft-state precondition; the route decides the command by reading the total.
 */
export async function requestIssue(ctx: RequestContext, id: string, totalMinor: bigint): Promise<Accepted & { requiresApproval: boolean }> {
  if (requiresApproval(totalMinor)) {
    const approvalId = randomUUID();
    await queue.publish(COMMANDS.invoiceRequestIssue, {
      messageId: approvalId, type: COMMANDS.invoiceRequestIssue, tenantId: ctx.tenantId,
      actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { approvalId, invoiceId: id, action: "issue", amountMinor: totalMinor.toString() },
    });
    await cache.invalidate(cache.makeKey(ctx.tenantId, "invoice", id));
    return { id, status: "pending_approval", correlationId: ctx.correlationId, requiresApproval: true };
  }
  await queue.publish(COMMANDS.invoiceIssue, {
    messageId: randomUUID(), type: COMMANDS.invoiceIssue, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "invoice", id));
  return { id, status: "accepted", correlationId: ctx.correlationId, requiresApproval: false };
}

/** Request to cancel a bill (draft/issued/partially_paid). Same maker-checker rule. */
export async function requestCancel(ctx: RequestContext, id: string, reason: string, totalMinor: bigint): Promise<Accepted & { requiresApproval: boolean }> {
  if (requiresApproval(totalMinor)) {
    const approvalId = randomUUID();
    await queue.publish(COMMANDS.invoiceRequestCancel, {
      messageId: approvalId, type: COMMANDS.invoiceRequestCancel, tenantId: ctx.tenantId,
      actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
      payload: { approvalId, invoiceId: id, action: "cancel", amountMinor: totalMinor.toString(), reason },
    });
    await cache.invalidate(cache.makeKey(ctx.tenantId, "invoice", id));
    return { id, status: "pending_approval", correlationId: ctx.correlationId, requiresApproval: true };
  }
  await queue.publish(COMMANDS.invoiceCancel, {
    messageId: randomUUID(), type: COMMANDS.invoiceCancel, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, reason },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "invoice", id));
  return { id, status: "accepted", correlationId: ctx.correlationId, requiresApproval: false };
}

/** Legacy full settlement of a bill (marks paid in one shot). */
export async function payInvoice(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.invoicePay, {
    messageId: randomUUID(), type: COMMANDS.invoicePay, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id },
  });
  await cache.invalidateResource(ctx.tenantId, "invoices");
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** Checker decision on a pending issue/cancel approval. */
export async function decideApproval(ctx: RequestContext, approvalId: string, approve: boolean, reason?: string): Promise<Accepted> {
  await queue.publish(COMMANDS.invoiceApprovalDecide, {
    messageId: randomUUID(),
    type: COMMANDS.invoiceApprovalDecide, tenantId: ctx.tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { approvalId, approve, ...(reason ? { reason } : {}) },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "approval", approvalId));
  return { id: approvalId, status: "accepted", correlationId: ctx.correlationId };
}
