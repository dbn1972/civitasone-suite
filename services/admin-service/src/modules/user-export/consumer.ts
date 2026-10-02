import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "admin-user-export-consumer" });

/** Errors are not swallowed: a failed audit write fails the message so the queue redelivers it. */
export function registerUserExportConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; rowCount: number; filter?: string }>(COMMANDS.userExportRecorded, async (msg) => {
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await auditEvent(
        tx,
        { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
        "user_directory.exported",
        "user_directory",
        msg.tenantId,
        { rowCount: msg.payload.rowCount, ...(msg.payload.filter ? { filter: msg.payload.filter } : {}) },
      );
    });
    log.info({ messageId: msg.messageId }, "user directory export recorded");
  });
}
