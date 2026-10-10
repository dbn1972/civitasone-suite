import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: "pending"; correlationId: string };

/**
 * Travel-request / expense-claim creates are commands: the route validates, then
 * publishes; the consumer (social/consumer.ts) does markProcessed + a guarded
 * INSERT + the audit event in ONE transaction.
 *
 * id AND messageId are both derived from the caller's x-idempotency-key when one is
 * supplied (idempotentId), so a double-submitted form collapses to one row: the
 * second delivery is dropped by markProcessed and, belt and braces, by the
 * `ON CONFLICT (id) DO NOTHING` in the consumer. Without a key each call is a new row.
 */
async function publish(topic: string, ctx: RequestContext, payload: Record<string, unknown>): Promise<Accepted> {
  const id = idempotentId(ctx);
  await queue.publish(topic, {
    messageId: id,
    type: topic,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { ...payload, id, tenantId: ctx.tenantId, employeeId: ctx.actorId },
  });
  return { id, status: "pending", correlationId: ctx.correlationId };
}

export interface CreateTravelRequestPayload {
  purpose: string;
  destination: string;
  fromDate: string;
  toDate: string;
  advanceRequired: number;
  mode: string;
  /** Reporting manager (best-effort, resolved by the route); only drives the approval notification. */
  managerId?: string;
}

export const createTravelRequest = (ctx: RequestContext, p: CreateTravelRequestPayload) =>
  publish(COMMANDS.travelRequestCreate, ctx, { ...p });

export interface CreateExpenseClaimPayload {
  category: string;
  amount: number;
  description: string;
  date: string;
  receiptKey: string | null;
  travelRequestId: string | null;
}

export const createExpenseClaim = (ctx: RequestContext, p: CreateExpenseClaimPayload) =>
  publish(COMMANDS.expenseCreate, ctx, { ...p });
