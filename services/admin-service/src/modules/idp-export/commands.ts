/**
 * w0-report (F5): records that a tenant admin exported the IdP-providers list
 * to CSV. Route -> publish command -> consumer writes the audit outbox row in a
 * transaction (fail-closed: a failed audit write redelivers). The CSV is built
 * in the browser, so rowCount is client-asserted; the actor, tenant and the
 * server-side timestamp come from the authenticated context, not the body.
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordIdpExport(ctx: RequestContext, rowCount: number, filtered: boolean): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.idpExportRecorded, {
    messageId: id,
    type: COMMANDS.idpExportRecorded,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rowCount, filtered, exportedAt: new Date().toISOString() },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
