import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "admin-table-export-consumer" });

/**
 * W1 SF-08. markProcessed + the audit outbox row share one transaction; errors
 * are not swallowed, so a failed audit write fails the message and the queue
 * redelivers it (fail-closed audit). A redelivery is a no-op.
 */
export function registerTableExportConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; resource: string; rowCount: number; filtered: boolean; exportedAt: string }>(
    COMMANDS.tableExportRecorded,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await auditEvent(
          tx,
          { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
          "table.exported",
          "table_export",
          msg.tenantId,
          { resource: msg.payload.resource, rowCount: msg.payload.rowCount, filtered: msg.payload.filtered, exportedAt: msg.payload.exportedAt },
        );
      });
      log.info({ messageId: msg.messageId }, "table export recorded");
    },
  );
}
