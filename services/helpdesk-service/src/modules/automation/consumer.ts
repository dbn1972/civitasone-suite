import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { eq, and, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { automationRules, type AutomationTrigger, type AutomationAction } from "./schema.js";

const log = pino({ name: "helpdesk.automation.consumer" });
const AUDIT = "audit.event.record";
const MAX_RULES_PER_TENANT = 100;

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
) {
  await enqueue(tx, {
    topic: AUDIT, eventType: AUDIT,
    tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType: "automation_rule", resourceId, outcome: "success" },
  });
}

export function registerAutomationConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.automationRuleCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name: string; ordinal: number; enabled: boolean;
      trigger: AutomationTrigger; actions: AutomationAction[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(automationRules)
        .where(and(eq(automationRules.tenantId, p.tenantId), eq(automationRules.status, "active")));
      if ((countRow?.count ?? 0) >= MAX_RULES_PER_TENANT) return;
      await tx.insert(automationRules).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        ordinal: p.ordinal,
        enabled: p.enabled,
        trigger: p.trigger,
        actions: p.actions,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await audit(tx, msg, "automation_rule_create", p.id);
    });
    log.info({ id: p.id }, "automation rule created");
  });

  queue.subscribe(COMMANDS.automationRuleUpdate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; name?: string; ordinal?: number; enabled?: boolean;
      trigger?: AutomationTrigger; actions?: AutomationAction[];
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx.select().from(automationRules)
        .where(and(eq(automationRules.id, p.id), eq(automationRules.tenantId, p.tenantId)))
        .limit(1);
      if (!existing) return;
      const updates: Record<string, unknown> = {
        updatedBy: msg.actorId,
        updatedAt: new Date(),
        version: existing.version + 1,
      };
      if (p.name !== undefined) updates.name = p.name;
      if (p.ordinal !== undefined) updates.ordinal = p.ordinal;
      if (p.enabled !== undefined) updates.enabled = p.enabled;
      if (p.trigger !== undefined) updates.trigger = p.trigger;
      if (p.actions !== undefined) updates.actions = p.actions;
      await tx.update(automationRules).set(updates)
        .where(and(eq(automationRules.id, p.id), eq(automationRules.tenantId, p.tenantId)));
      await audit(tx, msg, "automation_rule_update", p.id);
    });
  });

  queue.subscribe(COMMANDS.automationRuleDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx.select().from(automationRules)
        .where(and(eq(automationRules.id, p.id), eq(automationRules.tenantId, p.tenantId)))
        .limit(1);
      if (!existing) return;
      await tx.update(automationRules)
        .set({ status: "deleted", updatedBy: msg.actorId, updatedAt: new Date() })
        .where(and(eq(automationRules.id, p.id), eq(automationRules.tenantId, p.tenantId)));
      await audit(tx, msg, "automation_rule_delete", p.id);
    });
  });
}
