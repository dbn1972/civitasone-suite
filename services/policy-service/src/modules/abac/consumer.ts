import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS, RESOURCE } from "../../topics.js";
import * as repo from "./repo.js";
import { tenantScoped } from "../../shared/tenant-queue.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerAbacConsumers(q: Queue): void {
  // RLS (#146): every handler must run inside the message's tenant context.
  q = tenantScoped(q);
  q.subscribe<{ id: string; tenantId: string; roleId: string; expression: string; enabled: boolean }>(
    COMMANDS.createAbacRule, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await repo.insertRule(tx, {
          id: p.id, tenantId: p.tenantId, roleId: p.roleId, expression: p.expression,
          enabled: p.enabled, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1,
        });
        await emitAudit(tx, msg, EVENTS.abacRuleCreated, { ruleId: p.id, roleId: p.roleId }, "create", p.id);
      });
      await invalidate(msg.tenantId, msg.payload.id);
    },
  );

  q.subscribe<{ id: string; tenantId: string; expression?: string; enabled?: boolean }>(
    COMMANDS.updateAbacRule, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const cur = await repo.findRuleByIdTx(tx, msg.payload.tenantId, msg.payload.id);
        if (!cur) throw new Error(`abac rule ${msg.payload.id} not found`);
        const patch: Record<string, unknown> = { updatedBy: msg.actorId, version: cur.version + 1 };
        if (msg.payload.expression !== undefined) patch.expression = msg.payload.expression;
        if (msg.payload.enabled !== undefined) patch.enabled = msg.payload.enabled;
        await repo.updateRule(tx, msg.payload.tenantId, msg.payload.id, patch);
        await emitAudit(tx, msg, EVENTS.abacRuleUpdated, { ruleId: msg.payload.id }, "update", msg.payload.id);
      });
      await invalidate(msg.tenantId, msg.payload.id);
    },
  );

  q.subscribe<{ id: string; tenantId: string }>(
    COMMANDS.deleteAbacRule, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await repo.deleteRule(tx, msg.payload.tenantId, msg.payload.id);
        await emitAudit(tx, msg, EVENTS.abacRuleDeleted, { ruleId: msg.payload.id }, "delete", msg.payload.id);
      });
      await invalidate(msg.tenantId, msg.payload.id);
    },
  );
}

async function invalidate(tenantId: string, id: string): Promise<void> {
  await cache.invalidate(cache.makeKey(tenantId, RESOURCE.abacRule, id));
  await cache.invalidate(cache.makeKey(tenantId, `${RESOURCE.abacRule}_list`, tenantId));
}

async function emitAudit(tx: unknown, msg: CommandEnvelope, eventType: string, payload: Record<string, unknown>, action: string, resourceId: string): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, { topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload });
  await enqueue(t, { topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { service: "policy", action, resourceType: "abac_rule", resourceId, outcome: "success" } });
}
