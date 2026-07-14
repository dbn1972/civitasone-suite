import { pgSchema, uuid, varchar, integer, timestamp, jsonb, text } from "drizzle-orm/pg-core";
import { and, eq, sql, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";

const domainSchema = pgSchema("workflow");

/**
 * Gap 3 — per (topic, message_id) processing-attempt counter. The consumer
 * increments this on every failed handler attempt; after max_attempts the
 * message is moved to dead_letters instead of being retried forever.
 */
export const consumerAttempts = domainSchema.table("consumer_attempts", {
  topic: varchar("topic", { length: 128 }).notNull(),
  messageId: uuid("message_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  lastError: text("last_error"),
  firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Gap 3 — dead-letter store for poison messages (payload + last error). */
export const deadLetters = domainSchema.table("dead_letters", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull(),
  topic: varchar("topic", { length: 128 }).notNull(),
  messageId: uuid("message_id").notNull(),
  envelope: jsonb("envelope").$type<Record<string, unknown>>().notNull(),
  error: text("error").notNull(),
  attemptCount: integer("attempt_count").notNull().default(0),
  status: varchar("status", { length: 24 }).notNull().default("dead"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  requeuedAt: timestamp("requeued_at", { withTimezone: true }),
  requeuedBy: uuid("requeued_by"),
});

export type DeadLetterRow = typeof deadLetters.$inferSelect;

/**
 * Record a failed attempt and return the running attempt count. Atomic upsert
 * so concurrent redeliveries don't lose increments.
 */
export async function bumpAttempt(topic: string, messageId: string, tenantId: string, error: string): Promise<number> {
  const res = await db.execute(sql`
    INSERT INTO workflow.consumer_attempts (topic, message_id, tenant_id, attempt_count, last_error, updated_at)
    VALUES (${topic}, ${messageId}, ${tenantId}, 1, ${error}, now())
    ON CONFLICT (topic, message_id)
    DO UPDATE SET attempt_count = workflow.consumer_attempts.attempt_count + 1,
                  last_error = ${error}, updated_at = now()
    RETURNING attempt_count
  `);
  const rows = res as unknown as Array<{ attempt_count: number }>;
  return rows[0]?.attempt_count ?? 1;
}

/** Move a poison message to the dead-letter table (idempotent on topic+messageId). */
export async function deadLetter(
  topic: string,
  messageId: string,
  tenantId: string,
  envelope: Record<string, unknown>,
  error: string,
  attemptCount: number,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO workflow.dead_letters (tenant_id, topic, message_id, envelope, error, attempt_count, status)
    VALUES (${tenantId}, ${topic}, ${messageId}, ${JSON.stringify(envelope)}::jsonb, ${error}, ${attemptCount}, 'dead')
    ON CONFLICT (topic, message_id) DO NOTHING
  `);
}

/** Clear the attempt counter once a message processes successfully. */
export async function clearAttempts(topic: string, messageId: string): Promise<void> {
  await db.delete(consumerAttempts)
    .where(and(eq(consumerAttempts.topic, topic), eq(consumerAttempts.messageId, messageId)));
}

/** Admin list of dead letters, tenant-scoped. */
export async function listDeadLetters(tenantId: string, status: string | undefined, limit: number, offset: number): Promise<DeadLetterRow[]> {
  return scopedRead((tx) => tx.select().from(deadLetters)
    .where(and(
      eq(deadLetters.tenantId, tenantId),
      ...(status ? [eq(deadLetters.status, status)] : []),
    ))
    .orderBy(desc(deadLetters.createdAt))
    .limit(limit).offset(offset));
}

export async function findDeadLetter(id: string, tenantId: string): Promise<DeadLetterRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(deadLetters)
    .where(and(eq(deadLetters.id, id), eq(deadLetters.tenantId, tenantId)))
    .limit(1));
  return rows[0] ?? null;
}

/** Mark a dead letter requeued (after re-publishing it). */
export async function markRequeued(id: string, tenantId: string, actorId: string): Promise<boolean> {
  const updated = await db.update(deadLetters)
    .set({ status: "requeued", requeuedAt: new Date(), requeuedBy: actorId })
    .where(and(eq(deadLetters.id, id), eq(deadLetters.tenantId, tenantId), eq(deadLetters.status, "dead")))
    .returning({ id: deadLetters.id });
  return updated.length > 0;
}
