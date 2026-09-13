import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { notificationChannels, notificationChannelConfigs, type ChannelInsert } from "./schema.js";
import type { ChannelView } from "./domain.js";

function toView(r: typeof notificationChannels.$inferSelect): ChannelView {
  return { id: r.id, tenantId: r.tenantId, type: r.type, name: r.name, isDefault: r.isDefault, enabled: r.enabled, version: r.version };
}

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function findChannelsByTenant(tenantId: string, limit = 100): Promise<ChannelView[]> {
  return (await scopedRead((tx) => tx.select().from(notificationChannels).where(eq(notificationChannels.tenantId, tenantId)).limit(limit))).map(toView);
}

export async function findDefaultChannel(tenantId: string, type?: string): Promise<ChannelView | null> {
  const rows = await scopedRead((tx) => tx.select().from(notificationChannels).where(
    and(eq(notificationChannels.tenantId, tenantId), eq(notificationChannels.isDefault, true), eq(notificationChannels.enabled, true))
  ));
  const match = type ? rows.find((r) => r.type === type) : rows[0];
  return match ? toView(match) : null;
}

/**
 * TX-018 — tenant-scoped sibling of findDefaultChannel(). Reads through a
 * caller-supplied transaction handle so an already-open db.transaction()
 * (notification-service deliveries/consumer.ts's send handler, via
 * resolveChannelWithDefaultTx() -> getDefaultChannelTx() -> this) does not
 * open a second, bare scopedRead()/db.transaction() from inside itself:
 * under pool.max concurrent in-flight consumer transactions, the nested call
 * has no free connection to open on and deadlocks the pool silently. Route
 * every read that happens inside an already-open consumer transaction
 * through this, not findDefaultChannel().
 */
export async function findDefaultChannelTx(tx: Writer, tenantId: string, type?: string): Promise<ChannelView | null> {
  const rows = await tx.select().from(notificationChannels).where(
    and(eq(notificationChannels.tenantId, tenantId), eq(notificationChannels.isDefault, true), eq(notificationChannels.enabled, true))
  );
  const match = type ? rows.find((r) => r.type === type) : rows[0];
  return match ? toView(match) : null;
}

export async function insertChannel(tx: Writer, row: ChannelInsert): Promise<void> {
  await tx.insert(notificationChannels).values(row);
}

export async function insertChannelConfig(tx: Writer, row: typeof notificationChannelConfigs.$inferInsert): Promise<void> {
  await tx.insert(notificationChannelConfigs).values(row);
}

export async function findChannelById(id: string, tenantId: string): Promise<ChannelView | null> {
  const rows = await scopedRead((tx) => tx.select().from(notificationChannels)
    .where(and(eq(notificationChannels.id, id), eq(notificationChannels.tenantId, tenantId))).limit(1));
  return rows[0] ? toView(rows[0]) : null;
}
