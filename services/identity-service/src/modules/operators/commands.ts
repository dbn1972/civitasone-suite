/**
 * Route -> publish command for platform-operator management. Routes never write:
 * they run the cheap pre-checks (so the operator gets a synchronous 409 for a
 * request that cannot succeed) and publish. The consumer re-checks everything
 * inside its transaction and is the only writer. messageIds are fresh
 * randomUUID()s: a repeatable decision must never be de-duplicated away.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import {
  REFUSAL_MESSAGE, primaryRoleKey, removesLastSuperAdmin, sameId, validateChange,
  type RefusalCode, type RequestKind,
} from "./domain.js";

export type Accepted = { id: string; status: string; correlationId: string };

type ReadTx = Parameters<typeof repo.countActiveSuperAdmins>[0];

function refuse(code: RefusalCode, status = 409): never {
  throw new HttpError(status, code, REFUSAL_MESSAGE[code]);
}

function envelope(ctx: RequestContext, type: string, payload: Record<string, unknown>) {
  return {
    messageId: randomUUID(), type, tenantId: ctx.tenantId, actorId: ctx.actorId,
    correlationId: ctx.correlationId, schemaVersion: "1.0", payload,
  };
}

export async function requestChange(
  ctx: RequestContext, targetUserId: string, body: { kind: RequestKind; reason: string; toRole?: string | undefined },
): Promise<Accepted> {
  if (sameId(targetUserId, ctx.actorId)) refuse("SELF_ACTION");
  const target = await repo.loadAccountScoped(ctx.tenantId, targetUserId);
  if (!target) throw new HttpError(404, "NOT_FOUND", "user not found");
  const bad = validateChange(body.kind, target, body.toRole);
  if (bad) refuse(bad);
  const superCount = await scopedRead((tx) => repo.countActiveSuperAdmins(tx as unknown as ReadTx, ctx.tenantId));
  if (removesLastSuperAdmin(body.kind, target, body.toRole, superCount)) refuse("LAST_SUPER_ADMIN");
  if (await repo.hasPendingScoped(ctx.tenantId, target.id)) refuse("ALREADY_PENDING");
  const id = randomUUID();
  await queue.publish(COMMANDS.operatorRequest, envelope(ctx, COMMANDS.operatorRequest, {
    id, targetUserId, kind: body.kind, reason: body.reason, ...(body.toRole ? { toRole: body.toRole } : {}),
  }));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function decide(ctx: RequestContext, requestId: string, decision: "approve" | "reject", note: string | undefined): Promise<Accepted> {
  const req = await repo.findRequestScoped(ctx.tenantId, requestId);
  if (!req) throw new HttpError(404, "NOT_FOUND", "request not found");
  if (req.status !== "pending") throw new HttpError(409, "NOT_PENDING", `this request is already ${req.status}`);
  // Maker != checker: the requester can cancel their own request, never decide it.
  if (sameId(req.requestedBy, ctx.actorId)) refuse("SELF_ACTION");
  if (decision === "approve") {
    const target = await repo.loadAccountScoped(ctx.tenantId, req.targetUserId);
    if (target) {
      const superCount = await scopedRead((tx) => repo.countActiveSuperAdmins(tx as unknown as ReadTx, ctx.tenantId));
      if (removesLastSuperAdmin(req.kind as RequestKind, target, req.toRoleKey, superCount)) refuse("LAST_SUPER_ADMIN");
    }
  }
  await queue.publish(COMMANDS.operatorDecide, envelope(ctx, COMMANDS.operatorDecide, {
    requestId, decision, ...(note ? { note } : {}),
  }));
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

export async function cancel(ctx: RequestContext, requestId: string): Promise<Accepted> {
  const req = await repo.findRequestScoped(ctx.tenantId, requestId);
  if (!req) throw new HttpError(404, "NOT_FOUND", "request not found");
  if (!sameId(req.requestedBy, ctx.actorId)) throw new HttpError(403, "FORBIDDEN", "only the person who made a request can cancel it");
  if (req.status !== "pending") throw new HttpError(409, "NOT_PENDING", `this request is already ${req.status}`);
  await queue.publish(COMMANDS.operatorCancel, envelope(ctx, COMMANDS.operatorCancel, { requestId }));
  return { id: requestId, status: "accepted", correlationId: ctx.correlationId };
}

/**
 * Direct (non-request) status changes and platform-role revocations must not be a way around the
 * approval: used by the existing users / rbac routes.
 */
export async function assertNotPlatformOperator(tenantId: string, userId: string): Promise<void> {
  const op = await repo.loadOperatorScoped(tenantId, userId);
  if (op && primaryRoleKey(op.roleKeys)) {
    throw new HttpError(409, "OPERATOR_REQUIRES_APPROVAL",
      "this account is a platform operator: use Platform Operators > request a change, which needs a second super admin's approval");
  }
}

