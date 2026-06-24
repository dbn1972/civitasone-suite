import { idempotentId } from "@civitasone/auth";
import type { RequestContext } from "@civitasone/types";
import { queue, cache } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function scheduleBackup(ctx: RequestContext, tenantId: string, cronExpr: string): Promise<Accepted> {
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.backupSchedule, {
    messageId: id, type: COMMANDS.backupSchedule, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId, cronExpr },
  });
  await cache.invalidate(cache.makeKey(tenantId, "backup_runs", tenantId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}

export async function triggerBackup(ctx: RequestContext, tenantId: string): Promise<Accepted> {
  const id = idempotentId(ctx);
  await queue.publish(COMMANDS.backupTrigger, {
    messageId: id, type: COMMANDS.backupTrigger, tenantId,
    actorId: ctx.actorId, correlationId: ctx.correlationId, schemaVersion: "1.0",
    payload: { tenantId, runId: id },
  });
  await cache.invalidate(cache.makeKey(tenantId, "backup_runs", tenantId));
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
