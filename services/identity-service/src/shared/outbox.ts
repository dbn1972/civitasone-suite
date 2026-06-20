import { pgSchema, uuid, varchar, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { and, eq, isNull } from "drizzle-orm";
import type { Queue } from "@civitasone/queue";

export const outbox = pgSchema("_outbox");

export const outboxMessages = outbox.table("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: varchar("topic", { length: 128 }).notNull(),
  eventType: varchar("event_type", { length: 128 }).notNull(),
  tenantId: uuid("tenant_id").notNull(),
  actorId: uuid("actor_id").notNull(),
  correlationId: varchar("correlation_id", { length: 64 }).notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
});

export const processed = pgSchema("_inbox").table("processed", {
  messageId: uuid("message_id").primaryKey(),
  processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const outboxSchema = { outboxMessages, processed };

type Tx = { insert: (t: typeof outboxMessages) => { values: (v: unknown) => Promise<unknown> } };

export async function enqueue(
  tx: Tx,
  e: { topic: string; eventType: string; tenantId: string; actorId: string; correlationId: string; payload: Record<string, unknown> }
): Promise<void> {
  await tx.insert(outboxMessages).values(e);
}

export async function relayOnce(db: any, queue: Queue, batch = 100): Promise<number> {
  const rows = await db.select().from(outboxMessages).where(isNull(outboxMessages.publishedAt)).limit(batch);
  for (const row of rows) {
    await queue.publish(row.topic, {
      type: row.eventType, tenantId: row.tenantId, actorId: row.actorId,
      correlationId: row.correlationId, schemaVersion: "1.0", payload: row.payload,
    });
    await db.update(outboxMessages).set({ publishedAt: new Date() }).where(eq(outboxMessages.id, row.id));
  }
  return rows.length;
}

export function startRelay(db: any, queue: Queue, intervalMs = 500): NodeJS.Timeout {
  return setInterval(() => {
    relayOnce(db, queue).catch((err) => console.error({ err }, "outbox relay failed"));
  }, intervalMs);
}

export async function markProcessed(tx: any, messageId: string): Promise<boolean> {
  const existing = await tx.select().from(processed).where(eq(processed.messageId, messageId)).limit(1);
  if (existing.length) return false;
  await tx.insert(processed).values({ messageId });
  return true;
}

export { and, eq, isNull };
