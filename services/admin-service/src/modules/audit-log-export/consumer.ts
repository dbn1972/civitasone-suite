import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "admin-audit-log-export-consumer" });

/**
 * Errors are deliberately NOT swallowed: a failed audit write must fail the
 * message so the queue redelivers it, instead of silently losing the record of
 * an audit-trail export. Only whether a search filter was active is recorded,
 * never the raw search text.
 */
export function registerAuditLogExportConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; rowCount: number; filtered?: boolean }>(COMMANDS.auditLogExportRecorded, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await auditEvent(
        tx,
        { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        "export",
        "audit_log",
        "tenant_list",
        { rowCount: msg.payload.rowCount, filtered: msg.payload.filtered === true },
      );
    });
    log.info({ messageId: msg.messageId }, "audit log export recorded");
  });
}
