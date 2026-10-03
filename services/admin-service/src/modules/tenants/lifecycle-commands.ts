import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS, RESOURCE_TENANT } from "../../topics.js";
import type { LifecycleKind, EditPayload, ApprovalPolicy } from "./lifecycle-domain.js";

export type LifecycleAccepted = { id: string; status: "accepted"; correlationId: string };

export interface LifecycleRequestPayload {
  requestId: string;
  kind: LifecycleKind;
  reason: string;
  /** ISO timestamp; only meaningful for suspend. */
  effectiveAt: string | null;
  edit?: EditPayload;
  policy?: ApprovalPolicy;
  /** The caller's own tenant and roles, from the verified token -- the consumer re-applies the rules with them. */
  actorTenantId: string;
  actorRoles: string[];
}

export interface LifecycleDecisionPayload {
  requestId: string;
  decision: "approve" | "reject";
  comment: string | null;
  actorTenantId: string;
  actorRoles: string[];
}

// messageIds are fresh randomUUID()s on purpose. A lifecycle decision is a
// repeatable, stateful act (an approver may legitimately try again after a
// stale-version rejection); a deterministic id derived from entity+action
// would make the consumer's markProcessed() silently drop the later attempt.
// Double-submit safety comes from the unique open-request index and the
// conditional UPDATE in the consumer, not from the message id.

export async function requestLifecycleChange(
  ctx: RequestContext, tenantId: string,
  input: Omit<LifecycleRequestPayload, "requestId" | "actorTenantId" | "actorRoles">,
): Promise<LifecycleAccepted> {
  const requestId = randomUUID();
  const payload: LifecycleRequestPayload = { ...input, requestId, actorTenantId: ctx.tenantId, actorRoles: ctx.roles };
  await queue.publish(COMMANDS.tenantLifecycleRequest, {
    messageId: randomUUID(), type: COMMANDS.tenantLifecycleRequest, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  });
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE_TENANT, tenantId));
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

export async function decideLifecycleRequest(
  ctx: RequestContext, tenantId: string, requestId: string, decision: "approve" | "reject", comment: string | null,
): Promise<LifecycleAccepted> {
  const payload: LifecycleDecisionPayload = { requestId, decision, comment, actorTenantId: ctx.tenantId, actorRoles: ctx.roles };
  await queue.publish(COMMANDS.tenantLifecycleDecide, {
    messageId: randomUUID(), type: COMMANDS.tenantLifecycleDecide, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  });
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE_TENANT, tenantId));
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

export interface LifecycleCancelPayload {
  requestId: string;
  reason: string;
  actorTenantId: string;
  actorRoles: string[];
}

export async function cancelLifecycleRequest(
  ctx: RequestContext, tenantId: string, requestId: string, reason: string,
): Promise<LifecycleAccepted> {
  const payload: LifecycleCancelPayload = { requestId, reason, actorTenantId: ctx.tenantId, actorRoles: ctx.roles };
  await queue.publish(COMMANDS.tenantLifecycleCancel, {
    messageId: randomUUID(), type: COMMANDS.tenantLifecycleCancel, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  });
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE_TENANT, tenantId));
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

/** Published by the worker's due-sweep, never by an HTTP route. */
export async function publishExecuteDue(row: { id: string; tenantId: string; actorId: string }): Promise<void> {
  await queue.publish(COMMANDS.tenantLifecycleExecuteDue, {
    messageId: randomUUID(), type: COMMANDS.tenantLifecycleExecuteDue, tenantId: row.tenantId,
    actorId: row.actorId, correlationId: randomUUID(), schemaVersion: "1.0", payload: { requestId: row.id },
  });
}
