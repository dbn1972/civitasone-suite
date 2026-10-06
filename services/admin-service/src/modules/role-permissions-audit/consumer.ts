import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { markProcessed } from "../../shared/outbox.js";
import { auditEvent } from "../../shared/audit.js";
import { COMMANDS } from "../../topics.js";

const log = pino({ name: "admin-role-permissions-audit-consumer" });

/** Errors are not swallowed: a failed audit write must fail the message so it is redelivered. */
export function registerRolePermissionAuditConsumers(queue: Queue): void {
  queue.subscribe<{ id: string; tenantId: string; roleId: string; granted: string[]; revoked: string[]; reason: string | null }>(
    COMMANDS.rolePermissionsChanged,
    async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await auditEvent(
          tx,
          { tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId },
          "update",
          "role_permissions",
          msg.payload.roleId,
          { granted: msg.payload.granted, revoked: msg.payload.revoked, reason: msg.payload.reason },
        );
      });
      log.info({ messageId: msg.messageId }, "role permissions change recorded");
    },
  );
}
