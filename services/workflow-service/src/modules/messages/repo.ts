import { eq, and, lte, isNotNull } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  messageSubscriptions,
  signalSubscriptions,
  type MessageSubscriptionInsert,
  type MessageSubscriptionRow,
  type SignalSubscriptionInsert,
  type SignalSubscriptionRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertMessageSubscription(tx: Writer, row: MessageSubscriptionInsert): Promise<void> {
  await tx.insert(messageSubscriptions).values(row);
}

export async function insertSignalSubscription(tx: Writer, row: SignalSubscriptionInsert): Promise<void> {
  await tx.insert(signalSubscriptions).values(row);
}

export async function findActiveMessageSubscription(
  tenantId: string,
  messageName: string,
  correlationKey: string,
): Promise<MessageSubscriptionRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(messageSubscriptions)
    .where(and(
      eq(messageSubscriptions.tenantId, tenantId),
      eq(messageSubscriptions.messageName, messageName),
      eq(messageSubscriptions.correlationKey, correlationKey),
      eq(messageSubscriptions.status, "active"),
    ))
    .limit(1));
  return rows[0] ?? null;
}

/** Transactional read of a message subscription by id (for idempotency check in consumer). */
export async function findActiveMessageSubscriptionById(
  tx: Writer,
  id: string,
): Promise<MessageSubscriptionRow | null> {
  const rows = await (tx as typeof db).select().from(messageSubscriptions)
    .where(and(eq(messageSubscriptions.id, id), eq(messageSubscriptions.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function findActiveSignalSubscriptions(
  tenantId: string,
  signalName: string,
): Promise<SignalSubscriptionRow[]> {
  return scopedRead((tx) => tx.select().from(signalSubscriptions)
    .where(and(
      eq(signalSubscriptions.tenantId, tenantId),
      eq(signalSubscriptions.signalName, signalName),
      eq(signalSubscriptions.status, "active"),
    )));
}

/** Transactional read of a signal subscription by id (for idempotency check in consumer). */
export async function findActiveSignalSubscriptionById(
  tx: Writer,
  id: string,
): Promise<SignalSubscriptionRow | null> {
  const rows = await (tx as typeof db).select().from(signalSubscriptions)
    .where(and(eq(signalSubscriptions.id, id), eq(signalSubscriptions.status, "active")))
    .limit(1);
  return rows[0] ?? null;
}

export async function markMessageMatched(
  tx: Writer,
  id: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await tx.update(messageSubscriptions)
    .set({ status: "matched", matchedAt: new Date(), matchedPayload: payload })
    .where(eq(messageSubscriptions.id, id));
}

export async function markSignalMatched(tx: Writer, id: string): Promise<void> {
  await tx.update(signalSubscriptions)
    .set({ status: "matched", matchedAt: new Date() })
    .where(eq(signalSubscriptions.id, id));
}

export async function expireSubscription(tx: Writer, id: string): Promise<void> {
  await tx.update(messageSubscriptions)
    .set({ status: "expired" })
    .where(eq(messageSubscriptions.id, id));
}

export async function findExpiredSubscriptions(now: Date, batch: number): Promise<MessageSubscriptionRow[]> {
  return scopedRead((tx) => tx.select().from(messageSubscriptions)
    .where(and(
      eq(messageSubscriptions.status, "active"),
      isNotNull(messageSubscriptions.timeoutAt),
      lte(messageSubscriptions.timeoutAt, now),
    ))
    .limit(batch));
}

export async function findSubscriptionsByInstance(instanceId: string): Promise<{
  messages: MessageSubscriptionRow[];
  signals: SignalSubscriptionRow[];
}> {
  const messages = await scopedRead((tx) => tx.select().from(messageSubscriptions)
    .where(eq(messageSubscriptions.instanceId, instanceId)));
  const signals = await scopedRead((tx) => tx.select().from(signalSubscriptions)
    .where(eq(signalSubscriptions.instanceId, instanceId)));
  return { messages, signals };
}

/** Cancel all active subscriptions for an instance (used when instance is cancelled). */
export async function cancelSubscriptionsForInstance(tx: Writer, instanceId: string): Promise<void> {
  await tx.update(messageSubscriptions)
    .set({ status: "expired" })
    .where(and(eq(messageSubscriptions.instanceId, instanceId), eq(messageSubscriptions.status, "active")));
  await tx.update(signalSubscriptions)
    .set({ status: "expired" })
    .where(and(eq(signalSubscriptions.instanceId, instanceId), eq(signalSubscriptions.status, "active")));
}

export async function listSubscriptions(
  tenantId: string,
  limit: number,
  offset: number,
  status?: string,
): Promise<MessageSubscriptionRow[]> {
  const conds = [eq(messageSubscriptions.tenantId, tenantId)];
  if (status) conds.push(eq(messageSubscriptions.status, status));
  return scopedRead((tx) => tx.select().from(messageSubscriptions)
    .where(and(...conds))
    .limit(limit)
    .offset(offset));
}
