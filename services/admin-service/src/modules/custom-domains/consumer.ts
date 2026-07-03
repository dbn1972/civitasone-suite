/**
 * Custom Domains consumer — the ONLY code that writes Postgres for custom domains.
 * idempotency-check → apply write + outbox → refresh cache.
 */
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import { customDomains } from "./schema.js";
import { eq, and } from "drizzle-orm";

const log = pino({ name: "admin-custom-domains-consumer" });
const AUDIT_TOPIC = "audit.event.record";
const RESOURCE = "custom_domain";

function listKey(tenantId: string) { return cache.makeKey(tenantId, RESOURCE, "list"); }

export function registerCustomDomainConsumers(queue: Queue): void {
  queue.subscribe<{
    id: string; tenantId: string; domain: string;
    verificationMethod: string; verificationToken: string;
  }>(COMMANDS.customDomainRegister, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).insert(customDomains).values({
          id: p.id,
          tenantId: p.tenantId,
          domain: p.domain,
          status: "pending_verification",
          verificationToken: p.verificationToken,
          verificationMethod: p.verificationMethod,
          sslStatus: "pending",
          createdBy: msg.actorId,
          updatedBy: msg.actorId,
          version: 1,
        });
        await emit(tx, msg, "admin.custom_domain.registered", p, "register", p.id);
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.customDomainRegister }, "Consumer processing failed");
    }
  });

  queue.subscribe<{ domainId: string; tenantId: string }>(COMMANDS.customDomainVerify, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        // In production, DNS lookup would happen here. For now, mark as verified.
        await (tx as any).update(customDomains).set({
          status: "verified",
          verifiedAt: new Date(),
          updatedBy: msg.actorId,
          updatedAt: new Date(),
        }).where(and(eq(customDomains.id, p.domainId), eq(customDomains.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.custom_domain.verified", p, "verify", p.domainId);
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.customDomainVerify }, "Consumer processing failed");
    }
  });

  queue.subscribe<{ domainId: string; tenantId: string }>(COMMANDS.customDomainDelete, async (msg) => {
    try {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const p = msg.payload;
        await (tx as any).delete(customDomains)
          .where(and(eq(customDomains.id, p.domainId), eq(customDomains.tenantId, p.tenantId)));
        await emit(tx, msg, "admin.custom_domain.deleted", p, "delete", p.domainId);
      });
      await cache.invalidate(listKey(msg.payload.tenantId));
    } catch (err) {
      log.error({ err, messageId: msg.messageId, type: COMMANDS.customDomainDelete }, "Consumer processing failed");
    }
  });
}

async function emit(
  tx: unknown,
  msg: { tenantId: string; actorId: string; correlationId: string },
  eventType: string,
  payload: Record<string, unknown>,
  action: string,
  resourceId: string,
): Promise<void> {
  const t = tx as Parameters<typeof enqueue>[0];
  await enqueue(t, {
    topic: eventType, eventType, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId, payload,
  });
  await enqueue(t, {
    topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "admin", action, resourceType: RESOURCE, resourceId, outcome: "success" },
  });
}
