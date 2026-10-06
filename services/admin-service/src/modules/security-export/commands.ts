/**
 * GAP-TENANT-ADMIN-SECURITY-04: records that an admin exported the Security
 * Center events to CSV. Actor emails and source IPs are personal data under
 * DPDP, so an export must leave an audit trail. Route -> publish command ->
 * consumer writes the audit outbox row in a transaction. The CSV is built in
 * the browser, so rowCount is client-asserted (best-effort audit), and the
 * values exported are masked by default (see the web SecurityTable).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordSecurityEventsExport(ctx: RequestContext, rowCount: number, filtered: boolean): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.securityEventsExportRecorded, {
    messageId: id,
    type: COMMANDS.securityEventsExportRecorded,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rowCount, filtered },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
