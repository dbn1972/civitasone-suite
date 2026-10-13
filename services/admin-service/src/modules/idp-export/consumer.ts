import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "admin-idp-export-consumer" });

/**
 * w0-report (F5). markProcessed + the audit outbox row share one transaction;
 * errors are not swallowed, so a failed audit write fails the message and the
 * queue redelivers it (fail-closed audit). A redelivery is a no-op.
 */
export function registerIdpExportConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; rowCount: number; filtered: boolean; exportedAt: string }>(
    COMMANDS.idpExportRecorded,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await auditEvent(
          tx,
          { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
          "idp_providers.exported",
          "idp_providers",
          msg.tenantId,
          { rowCount: msg.payload.rowCount, filtered: msg.payload.filtered, exportedAt: msg.payload.exportedAt },
        );
      });
      log.info({ messageId: msg.messageId }, "idp providers export recorded");
    },
  );
}
