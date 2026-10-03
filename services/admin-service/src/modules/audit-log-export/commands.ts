/**
 * GAP-ADMIN-AUDIT-LOG-03: records that an operator exported the platform audit
 * log to CSV. Route -> publish command -> consumer writes the audit outbox row.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordAuditLogExport(ctx: RequestContext, rowCount: number, filtered: boolean): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.auditLogExportRecorded, {
    messageId: id,
    type: COMMANDS.auditLogExportRecorded,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rowCount, filtered },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
