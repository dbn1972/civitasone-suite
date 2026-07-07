import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createRevenueLedger(
  ctx: RequestContext,
  payload: {
    subscriptionId: string;
    totalAmountPaise: bigint;
    servicePeriodStart: string;
    servicePeriodEnd: string;
    totalDays: number;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.revenueLedgerCreate, {
    messageId: id,
    type: COMMANDS.revenueLedgerCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      subscriptionId: payload.subscriptionId,
      totalAmountPaise: payload.totalAmountPaise.toString(),
      servicePeriodStart: payload.servicePeriodStart,
      servicePeriodEnd: payload.servicePeriodEnd,
      totalDays: payload.totalDays,
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "revenue-ledger", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function processAccrual(
  ctx: RequestContext,
  ledgerId: string,
  accrualDate: string,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.revenueAccrualProcess, {
    messageId: id,
    type: COMMANDS.revenueAccrualProcess,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, ledgerId, accrualDate, tenantId: ctx.tenantId },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
