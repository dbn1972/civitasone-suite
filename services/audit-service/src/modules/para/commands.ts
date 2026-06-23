import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { DeptResponseBody, SettleBody, PendingRecoveryBody, CloseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function issuePara(ctx: RequestContext, paraId: string): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.paraIssue, {
    messageId,
    type: COMMANDS.paraIssue,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function deptResponse(ctx: RequestContext, paraId: string, body: DeptResponseBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.paraDeptResponse, {
    messageId,
    type: COMMANDS.paraDeptResponse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function settlePara(ctx: RequestContext, paraId: string, body: SettleBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.paraSettle, {
    messageId,
    type: COMMANDS.paraSettle,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function pendingRecovery(ctx: RequestContext, paraId: string, body: PendingRecoveryBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.paraPendingRecovery, {
    messageId,
    type: COMMANDS.paraPendingRecovery,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function closePara(ctx: RequestContext, paraId: string, body: CloseBody): Promise<Accepted> {
  const messageId = randomUUID();
  await queue.publish(COMMANDS.paraClose, {
    messageId,
    type: COMMANDS.paraClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}
