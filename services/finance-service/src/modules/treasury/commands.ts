import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { idempotentId } from "@civitasone/auth";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateChallanBody, CreateDepositBody, DepositDispositionBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createChallan(ctx: RequestContext, body: CreateChallanBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.challanCreate, {
    messageId: id, type: COMMANDS.challanCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createDeposit(ctx: RequestContext, body: CreateDepositBody): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.depositCreate, {
    messageId: id, type: COMMANDS.depositCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

/** P1-3: deposit lifecycle dispositions — refund | forfeit | adjust-against-bill. */
async function publishDisposition(
  topic: string, ctx: RequestContext, depositId: string, body: DepositDispositionBody,
): Promise<Accepted> {
  // M3: derive a stable command id from the client idempotency key (scoped to
  // the topic + deposit) so a double-submit dedupes at the consumer instead of
  // creating a second disposition. Falls back to random when no key is supplied.
  const id = idempotentId(
    ctx.idempotencyKey ? { idempotencyKey: `${topic}:${depositId}:${ctx.idempotencyKey}` } : {},
  );
  await queue.publish(topic, {
    messageId: id, type: topic,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, depositId, ...body },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export function refundDeposit(ctx: RequestContext, depositId: string, body: DepositDispositionBody): Promise<Accepted> {
  return publishDisposition(COMMANDS.depositRefund, ctx, depositId, body);
}
export function forfeitDeposit(ctx: RequestContext, depositId: string, body: DepositDispositionBody): Promise<Accepted> {
  return publishDisposition(COMMANDS.depositForfeit, ctx, depositId, body);
}
export function adjustDeposit(ctx: RequestContext, depositId: string, body: DepositDispositionBody): Promise<Accepted> {
  return publishDisposition(COMMANDS.depositAdjust, ctx, depositId, body);
}
