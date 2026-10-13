/**
 * W1 SF-08: records that a signed-in user exported a DataTable to CSV, for the
 * screens that have no resource-specific export-audit route. Route -> publish
 * command -> consumer writes the audit outbox row in a transaction (fail-closed:
 * a failed audit write redelivers). The CSV is built in the browser, so rowCount
 * and resource are client-asserted; actor, tenant and the server-side timestamp
 * come from the authenticated context, never the body.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordTableExport(ctx: RequestContext, resource: string, rowCount: number, filtered: boolean): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.tableExportRecorded, {
    messageId: id,
    type: COMMANDS.tableExportRecorded,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, resource, rowCount, filtered, exportedAt: new Date().toISOString() },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
