import type { Queue } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { pino } from "pino";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { authorityLimits } from "./schema.js";
const log = pino({ name: "workflow-authority-consumer" });
const AUDIT = "audit.event.record";
async function audit(tx: Parameters<typeof enqueue>[0], msg: { tenantId: string; actorId: string; correlationId: string }, action: string, id: string) {
  await enqueue(tx, { topic: AUDIT, eventType: AUDIT, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
    payload: { service: "workflow", action, resourceType: "authority_limit", resourceId: id, outcome: "success" } });
}
export function registerAuthorityConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.createAuthorityLimit, async (msg) => {
    const p = msg.payload as Record<string, unknown>;
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.insert(authorityLimits).values({
          id: p.id as string, tenantId: p.tenantId as string, scopeType: p.scopeType as string, scopeRef: p.scopeRef as string,
          authorityType: p.authorityType as string, currency: p.currency as string, maxAmount: BigInt(p.maxAmount as string),
          effectiveFrom: p.effectiveFrom as string, effectiveTo: (p.effectiveTo as string | null) ?? null,
          escalateToScopeType: (p.escalateToScopeType as string | null) ?? null, escalateToRef: (p.escalateToRef as string | null) ?? null,
          reason: (p.reason as string | null) ?? null, status: "draft", createdBy: msg.actorId,
        });
        await enqueue(tx, { topic: EVENTS.authorityLimitCreated, eventType: EVENTS.authorityLimitCreated, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id } });
        await audit(tx, msg, "create", p.id as string);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "createAuthorityLimit failed"); throw err; }
  });
  queue.subscribe(COMMANDS.approveAuthorityLimit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.update(authorityLimits).set({ status: "active", approvedBy: msg.actorId, approvedAt: new Date(), updatedAt: new Date() })
          .where(and(eq(authorityLimits.id, p.id), eq(authorityLimits.tenantId, p.tenantId), eq(authorityLimits.status, "draft")));
        await enqueue(tx, { topic: EVENTS.authorityLimitApproved, eventType: EVENTS.authorityLimitApproved, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id } });
        await audit(tx, msg, "approve", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "approveAuthorityLimit failed"); throw err; }
  });
  queue.subscribe(COMMANDS.revokeAuthorityLimit, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        await tx.update(authorityLimits).set({ status: "revoked", updatedAt: new Date() })
          .where(and(eq(authorityLimits.id, p.id), eq(authorityLimits.tenantId, p.tenantId)));
        await enqueue(tx, { topic: EVENTS.authorityLimitRevoked, eventType: EVENTS.authorityLimitRevoked, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { id: p.id } });
        await audit(tx, msg, "revoke", p.id);
      });
    } catch (err) { log.error({ err, messageId: msg.messageId }, "revokeAuthorityLimit failed"); throw err; }
  });
}
