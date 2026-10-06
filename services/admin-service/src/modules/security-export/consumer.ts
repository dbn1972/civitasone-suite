import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "admin-security-export-consumer" });

/**
 * GAP-TENANT-ADMIN-SECURITY-04. Errors are not swallowed: a failed audit write
 * fails the message so the queue redelivers it (fail-closed audit).
 */
export function registerSecurityExportConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; rowCount: number; filtered: boolean }>(
    COMMANDS.securityEventsExportRecorded,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await auditEvent(
          tx,
          { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
          "security_events.exported",
          "security_events",
          msg.tenantId,
          { rowCount: msg.payload.rowCount, filtered: msg.payload.filtered },
        );
      });
      log.info({ messageId: msg.messageId }, "security events export recorded");
    },
  );
}
