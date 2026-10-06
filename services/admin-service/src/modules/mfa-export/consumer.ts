import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "admin-mfa-export-consumer" });

/**
 * GAP-TENANT-ADMIN-MFA-03. Errors are not swallowed: a failed audit write
 * fails the message so the queue redelivers it (fail-closed audit).
 */
export function registerMfaExportConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; rowCount: number; filtered: boolean }>(
    COMMANDS.mfaExportRecorded,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await auditEvent(
          tx,
          { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
          "mfa_status.exported",
          "mfa_status",
          msg.tenantId,
          { rowCount: msg.payload.rowCount, filtered: msg.payload.filtered },
        );
      });
      log.info({ messageId: msg.messageId }, "mfa status export recorded");
    },
  );
}
