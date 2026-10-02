/**
 * GAP-ADMIN-USERS-06: records that an operator exported the admin user
 * directory to CSV. Route -> publish command -> consumer writes the audit
 * outbox row. The CSV is built in the browser, so rowCount is client-asserted
 * (best-effort audit).
 */
import { randomUUID } from "node:crypto";
import type { RequestContext } from "@civitasone/types";
import { queue } from "../../shared/infra.js";
import { COMMANDS } from "../../topics.js";

export type Accepted = { id: string; status: string; correlationId: string };

export async function recordUserExport(ctx: RequestContext, rowCount: number, filter?: string): Promise<Accepted> {
  const id = randomUUID();
  await queue.publish(COMMANDS.userExportRecorded, {
    messageId: id,
    type: COMMANDS.userExportRecorded,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    schemaVersion: "1.0",
    payload: { id, tenantId: ctx.tenantId, rowCount, ...(filter ? { filter } : {}) },
  });
  return { id, status: "accepted", correlationId: ctx.correlationId };
}
