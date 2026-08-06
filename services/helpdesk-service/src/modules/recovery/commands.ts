import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function createPolicy(
  ctx: RequestContext,
  body: {
    severityThreshold: string;
    productCode?: string | null | undefined;
    maxGoodwillMinor: bigint;
    currency: string;
    requiresApproval: boolean;
    approverRole: string;
    active: boolean;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.recoveryPolicyCreate, {
    messageId: id,
    type: COMMANDS.recoveryPolicyCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, ...body, maxGoodwillMinor: body.maxGoodwillMinor.toString() },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function createAction(
  ctx: RequestContext,
  ticketId: string,
  body: {
    policyId: string;
    actionType: string;
    amountMinor?: bigint | null | undefined;
    currency: string;
    reason?: string | undefined;
  },
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.recoveryActionCreate, {
    messageId: id,
    type: COMMANDS.recoveryActionCreate,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: {
      id,
      tenantId: ctx.tenantId,
      ticketId,
      ...body,
      amountMinor: body.amountMinor?.toString() ?? null,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function approveAction(ctx: RequestContext, actionId: string, reason?: string): Promise<Accepted> {
  await queue.publish(COMMANDS.recoveryActionApprove, {
    messageId: randomUUID(),
    type: COMMANDS.recoveryActionApprove,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: actionId, tenantId: ctx.tenantId, reason },
  });
  return { id: actionId, status: "accepted", correlationId: ctx.correlationId };
}

export async function rejectAction(ctx: RequestContext, actionId: string, reason?: string): Promise<Accepted> {
  await queue.publish(COMMANDS.recoveryActionReject, {
    messageId: randomUUID(),
    type: COMMANDS.recoveryActionReject,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id: actionId, tenantId: ctx.tenantId, reason },
  });
  return { id: actionId, status: "accepted", correlationId: ctx.correlationId };
}
