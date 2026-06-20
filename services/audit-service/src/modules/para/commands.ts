import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { DeptResponseBody, SettleBody, PendingRecoveryBody, CloseBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function issuePara(ctx: RequestContext, paraId: string): Promise<Accepted> {
  await queue.publish(COMMANDS.paraIssue, {
    type: COMMANDS.paraIssue,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function deptResponse(ctx: RequestContext, paraId: string, body: DeptResponseBody): Promise<Accepted> {
  await queue.publish(COMMANDS.paraDeptResponse, {
    type: COMMANDS.paraDeptResponse,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function settlePara(ctx: RequestContext, paraId: string, body: SettleBody): Promise<Accepted> {
  await queue.publish(COMMANDS.paraSettle, {
    type: COMMANDS.paraSettle,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function pendingRecovery(ctx: RequestContext, paraId: string, body: PendingRecoveryBody): Promise<Accepted> {
  await queue.publish(COMMANDS.paraPendingRecovery, {
    type: COMMANDS.paraPendingRecovery,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}

export async function closePara(ctx: RequestContext, paraId: string, body: CloseBody): Promise<Accepted> {
  await queue.publish(COMMANDS.paraClose, {
    type: COMMANDS.paraClose,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { paraId, tenantId: ctx.tenantId, ...body },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "para", paraId));
  return { id: paraId, status: "accepted", correlationId: ctx.correlationId };
}
