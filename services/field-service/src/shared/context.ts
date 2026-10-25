import type { FastifyRequest } from "fastify";
import { resolveServiceContext, AuthContextError } from "@civitasone/auth/context";
import { requirePermission } from "@civitasone/auth/permissions";
import { hasAnyRole } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { db } from "./db.js";
import { writeAudit } from "./audit.js";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function resolveContext(req: FastifyRequest): RequestContext {
  try {
    return resolveServiceContext(req);
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

export function requireRole(ctx: RequestContext, roles: string[]): void {
  if (!hasAnyRole(ctx, roles)) {
    throw new HttpError(403, "FORBIDDEN", `requires one of: ${roles.join(", ")}`);
  }
}

export async function requirePermissionKey(ctx: RequestContext, permissionKey: string): Promise<void> {
  try {
    await requirePermission(ctx, permissionKey);
  } catch (err) {
    if (err instanceof AuthContextError) {
      throw new HttpError(err.status, err.code, err.message);
    }
    throw err;
  }
}

/** Tenant-wide field visibility (supervisor/admin). Plain field_agents are limited to their own records. */
export const FIELD_SUPERVISOR_ROLES = ["field_admin", "super_admin"];
export function isFieldSupervisor(ctx: RequestContext): boolean {
  return hasAnyRole(ctx, FIELD_SUPERVISOR_ROLES);
}

/**
 * Q17: mutating an individual task (start / complete) or checking in to it is
 * limited to the assigned agent or a field supervisor. Any other field_agent
 * gets 403 and the refusal is written to the audit trail (best effort: an audit
 * failure must never turn a clean 403 into a 500).
 */
export async function assertAssignedOrSupervisor(
  ctx: RequestContext,
  task: { id: string; assigneeId: string | null },
  action: string,
  log?: { error: (obj: object, msg: string) => void },
): Promise<void> {
  if (isFieldSupervisor(ctx) || (task.assigneeId !== null && task.assigneeId === ctx.actorId)) return;
  try {
    await db.transaction((tx) =>
      writeAudit(tx, ctx, {
        action: `field.task.${action}.denied`,
        resourceType: "field_task",
        resourceId: task.id,
        outcome: "denied",
        details: { reason: "not_assigned_agent", assigneeId: task.assigneeId },
      }),
    );
  } catch (err) {
    // audit is best effort on the denial path: the 403 still stands, but the failed write is logged
    log?.error({ err, action: `field.task.${action}.denied`, taskId: task.id }, "denial audit write failed");
  }
  throw new HttpError(403, "FORBIDDEN", "only the assigned agent or a field supervisor may perform this action");
}
