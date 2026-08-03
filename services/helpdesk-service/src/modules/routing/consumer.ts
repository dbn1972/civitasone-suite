import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { eq, and, sql, desc, asc } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { tenantScoped } from "../../shared/tenant-queue.js";
import { COMMANDS } from "../../topics.js";
import { routingRules } from "./schema.js";
import { agentCapacity } from "./capacity-schema.js";
import { holdQueue } from "./queue-schema.js";

const log = pino({ name: "helpdesk.routing.consumer" });
const AUDIT = "audit.event.record";

async function audit(
  tx: Parameters<typeof enqueue>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceId: string,
  outcome = "success",
) {
  await enqueue(tx, {
    topic: AUDIT,
    eventType: AUDIT,
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "helpdesk", action, resourceType: "routing", resourceId, outcome },
  });
}

export function registerRoutingConsumers(rawQueue: Queue): void {
  const queue = tenantScoped(rawQueue);

  queue.subscribe(COMMANDS.routingRuleCreate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      name: string;
      strategy: string;
      criteria: Record<string, unknown> | null;
      weight: number;
      enabled: boolean;
      ordinal: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(routingRules).values({
        id: p.id,
        tenantId: p.tenantId,
        name: p.name,
        strategy: p.strategy,
        criteria: p.criteria,
        weight: p.weight,
        enabled: p.enabled,
        ordinal: p.ordinal,
        createdBy: msg.actorId,
      });
      await audit(tx, msg, "routing_rule_create", p.id);
    });
    log.info({ id: p.id }, "routing rule created");
  });

  queue.subscribe(COMMANDS.routingRuleUpdate, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      version: number;
      name?: string;
      strategy?: string;
      criteria?: Record<string, unknown> | null;
      weight?: number;
      enabled?: boolean;
      ordinal?: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx
        .select()
        .from(routingRules)
        .where(and(eq(routingRules.id, p.id), eq(routingRules.tenantId, p.tenantId)))
        .limit(1);
      if (!existing || existing.version !== p.version) {
        await audit(tx, msg, "routing_rule_update", p.id, "rejected_version_conflict");
        return;
      }
      await tx
        .update(routingRules)
        .set({
          ...(p.name !== undefined && { name: p.name }),
          ...(p.strategy !== undefined && { strategy: p.strategy }),
          ...(p.criteria !== undefined && { criteria: p.criteria ?? null }),
          ...(p.weight !== undefined && { weight: p.weight }),
          ...(p.enabled !== undefined && { enabled: p.enabled }),
          ...(p.ordinal !== undefined && { ordinal: p.ordinal }),
          updatedAt: new Date(),
          version: sql`${routingRules.version} + 1`,
        })
        .where(and(eq(routingRules.id, p.id), eq(routingRules.version, p.version)));
      await audit(tx, msg, "routing_rule_update", p.id);
    });
  });

  queue.subscribe(COMMANDS.routingRuleDelete, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [updated] = await tx
        .update(routingRules)
        .set({ enabled: false, updatedAt: new Date(), version: sql`${routingRules.version} + 1` })
        .where(and(eq(routingRules.id, p.id), eq(routingRules.tenantId, p.tenantId)))
        .returning();
      if (updated) await audit(tx, msg, "routing_rule_delete", p.id);
    });
  });

  queue.subscribe(COMMANDS.routingCapacityUpsert, async (msg) => {
    const p = msg.payload as {
      agentId: string;
      tenantId: string;
      maxTickets?: number;
      skills?: string[];
      available?: boolean;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [existing] = await tx
        .select()
        .from(agentCapacity)
        .where(and(eq(agentCapacity.agentId, p.agentId), eq(agentCapacity.tenantId, p.tenantId)))
        .limit(1);

      if (!existing) {
        await tx.insert(agentCapacity).values({
          tenantId: p.tenantId,
          agentId: p.agentId,
          maxTickets: p.maxTickets ?? 10,
          skills: p.skills ?? [],
          available: p.available ?? true,
        });
      } else {
        await tx
          .update(agentCapacity)
          .set({
            ...(p.maxTickets !== undefined && { maxTickets: p.maxTickets }),
            ...(p.skills !== undefined && { skills: p.skills }),
            ...(p.available !== undefined && { available: p.available }),
            updatedAt: new Date(),
            version: sql`${agentCapacity.version} + 1`,
          })
          .where(and(eq(agentCapacity.id, existing.id), eq(agentCapacity.version, existing.version)));
      }
      await audit(tx, msg, "routing_capacity_upsert", p.agentId);
    });
  });

  queue.subscribe(COMMANDS.routingQueueEnqueue, async (msg) => {
    const p = msg.payload as {
      id?: string;
      tenantId: string;
      ticketId: string;
      queueName: string;
      priority: number;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      await tx.insert(holdQueue).values({
        ...(p.id ? { id: p.id } : {}),
        tenantId: p.tenantId,
        ticketId: p.ticketId,
        queueName: p.queueName,
        priority: p.priority,
      });
      await audit(tx, msg, "routing_queue_enqueue", p.ticketId);
    });
  });

  queue.subscribe(COMMANDS.routingQueueDequeue, async (msg) => {
    const p = msg.payload as { tenantId: string; queueName: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const [next] = await tx
        .select()
        .from(holdQueue)
        .where(and(eq(holdQueue.tenantId, p.tenantId), eq(holdQueue.queueName, p.queueName)))
        .orderBy(desc(holdQueue.priority), asc(holdQueue.enteredAt))
        .limit(1);
      if (!next) {
        await audit(tx, msg, "routing_queue_dequeue", p.queueName, "empty_queue");
        return;
      }
      await tx.delete(holdQueue).where(eq(holdQueue.id, next.id));
      await audit(tx, msg, "routing_queue_dequeue", next.ticketId);
    });
  });
}
