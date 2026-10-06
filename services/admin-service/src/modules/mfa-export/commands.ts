/**
 * GAP-TENANT-ADMIN-MFA-03: records that an admin exported the MFA-status list
 * to CSV. Staff names and email addresses are personal data under DPDP, so a
 * bulk extraction must leave an audit trail. Route -> publish command ->
 * consumer writes the audit outbox row in a transaction (fail-closed: a failed
 * audit write redelivers). The CSV is built in the browser, so rowCount is
 * client-asserted (best-effort), and emails are masked by default in the file
 * (see the web MfaTable).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordMfaExport(ctx: RequestContext, rowCount: number, filtered: boolean): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.mfaExportRecorded, {
    messageId: id,
    type: COMMANDS.mfaExportRecorded,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rowCount, filtered },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
