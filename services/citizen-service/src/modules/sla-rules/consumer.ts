import type { Queue } from "@civitasone/queue";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";

const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "citizen", action, resourceType: "sla_rule", resourceId, outcome: "success" },
  });
}

export function registerSlaRulesConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.slaRuleUpsert, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; priority: string;
      escalationHours: number; escalateTo: string; isActive: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await repo.upsertRuleTx(tx, {
        id: p.id,
        tenantId: p.tenantId,
        priority: p.priority,
        escalationHours: p.escalationHours,
        escalateTo: p.escalateTo,
        isActive: p.isActive,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "upsert", p.id);
    });
  });
}
