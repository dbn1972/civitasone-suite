import type { Queue, CommandEnvelope } from "@civitasone/queue";
import { and, eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { mfaConfigs } from "./schema.js";
import { users } from "../users/schema.js";

const AUDIT_TOPIC = "audit.event.record";

export function registerMfaConsumers(q: Queue): void {
  q.subscribe<{ id: string; userId: string; method: string; tenantId: string }>(
    COMMANDS.enableMfa, async (msg) => {
      await db.transaction(async (tx) => {
        if (!(await markProcessed(tx, msg.messageId))) return;
        const { id, userId, method, tenantId } = msg.payload;
        const existing = await tx.select().from(mfaConfigs).where(and(eq(mfaConfigs.userId, userId), eq(mfaConfigs.tenantId, tenantId))).limit(1);
        if (existing.length) {
          await tx.update(mfaConfigs).set({ method, enabled: true, updatedBy: msg.actorId, version: (existing[0]?.version ?? 0) + 1, updatedAt: new Date() }).where(and(eq(mfaConfigs.userId, userId), eq(mfaConfigs.tenantId, tenantId)));
        } else {
          await tx.insert(mfaConfigs).values({ id, tenantId, userId, method, enabled: true, createdBy: msg.actorId, updatedBy: msg.actorId, version: 1 });
        }
        await tx.update(users).set({ mfaEnabled: true, updatedBy: msg.actorId, updatedAt: new Date() }).where(and(eq(users.id, userId), eq(users.tenantId, tenantId)));
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: EVENTS.mfaEnabled, eventType: EVENTS.mfaEnabled, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId, payload: { userId, method },
        });
        await enqueue(tx as Parameters<typeof enqueue>[0], {
          topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC, tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
          payload: { service: "identity", action: "mfa_enable", resourceType: "user", resourceId: userId, outcome: "success" },
        });
      });
    }
  );
}
