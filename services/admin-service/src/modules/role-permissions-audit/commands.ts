/**
 * Records the operator-supplied reason for an RBAC role-permission change.
 * Route -> publish command -> consumer writes the audit outbox row.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export async function recordRolePermissionsChange(
  ctx: RequestContext, roleId: string, granted: string[], revoked: string[], reason?: string,
): Promise<void> {
  const id = randomUUID();
  await queue.publish(COMMANDS.rolePermissionsChanged, {
    messageId: id,
    type: COMMANDS.rolePermissionsChanged,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, roleId, granted, revoked, reason: reason ?? null },
  });
}
