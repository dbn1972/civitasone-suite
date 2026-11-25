import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, CONSUMED_EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import { assertCanAssign, assertCanClose } from "./domain.js";

const AUDIT_TOPIC = CONSUMED_EVENTS.auditEventRecord;

class StaleWriteError extends Error {
  readonly status = 409;
  readonly code = "VERSION_CONFLICT";
  constructor(id: string) {
    super(`[VERSION_CONFLICT] investigation ${id} was modified concurrently`);
  }
}

export function registerInvestigationConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.investigationAssign, async (msg) => {
    const p = msg.payload as { investigationId: string; tenantId: string; assignedTo: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findInvestigationByIdTx(tx, p.investigationId, p.tenantId);
      if (!row) throw new Error(`investigation ${p.investigationId} not found`);
      assertCanAssign(row.status);
      const n = await repo.updateInvestigationVersioned(tx, p.investigationId, p.tenantId, row.version ?? 1, {
        assignedTo: p.assignedTo, updatedBy: msg.actorId, version: (row.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError(p.investigationId);
      await audit(tx, msg, "assign", p.investigationId, { assignedTo: p.assignedTo });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "investigation", "list:50:0"));
  });

  queue.subscribe(COMMANDS.investigationClose, async (msg) => {
    const p = msg.payload as { investigationId: string; tenantId: string; outcome: string; reason: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const row = await repo.findInvestigationByIdTx(tx, p.investigationId, p.tenantId);
      if (!row) throw new Error(`investigation ${p.investigationId} not found`);
      assertCanClose(row.status);
      const n = await repo.updateInvestigationVersioned(tx, p.investigationId, p.tenantId, row.version ?? 1, {
        status: "closed", closeOutcome: p.outcome, closeReason: p.reason, closedAt: new Date(),
        updatedBy: msg.actorId, version: (row.version ?? 1) + 1,
      });
      if (n !== 1) throw new StaleWriteError(p.investigationId);
      await audit(tx, msg, "close", p.investigationId, { outcome: p.outcome, reason: p.reason });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "investigation", "list:50:0"));
  });
}

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string, resourceId: string, newValue: Record<string, unknown>,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "audit", action, resourceType: "investigation", resourceId, outcome: "success", newValue },
  });
}
