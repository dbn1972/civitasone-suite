import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";
import type { CreateApprovalLevelBody, UpdateApprovalLevelBody } from "./validators.js";

export type Accepted = { id: string; status: string; correlationId: string };

/** Queue-first create — ordinal is resolved by the route from a pre-publish count read. */
export async function createApprovalLevel(
  ctx: RequestContext, ordinal: number, body: CreateApprovalLevelBody,
): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.approvalLevelCreate, {
    messageId: id, type: COMMANDS.approvalLevelCreate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId, ordinal,
      minValuePaise: body.minValuePaise, requiredRole: body.requiredRole, label: body.label,
    },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function updateApprovalLevel(
  ctx: RequestContext, id: string, version: number, body: UpdateApprovalLevelBody,
): Promise<Accepted> {
  await queue.publish(COMMANDS.approvalLevelUpdate, {
    messageId: randomUUID(), type: COMMANDS.approvalLevelUpdate,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: {
      id, tenantId: ctx.tenantId, version,
      ...(body.minValuePaise !== undefined && { minValuePaise: body.minValuePaise }),
      ...(body.requiredRole !== undefined && { requiredRole: body.requiredRole }),
      ...(body.label !== undefined && { label: body.label }),
    },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "approval-level", id));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function deleteApprovalLevel(ctx: RequestContext, id: string): Promise<Accepted> {
  await queue.publish(COMMANDS.approvalLevelDelete, {
    messageId: randomUUID(), type: COMMANDS.approvalLevelDelete,
    tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId },
  });
  await cache.invalidate(cache.makeKey(ctx.tenantId, "approval-level", id));
  await cache.invalidate(cache.makeKey(ctx.tenantId, "approval-level", "list"));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
