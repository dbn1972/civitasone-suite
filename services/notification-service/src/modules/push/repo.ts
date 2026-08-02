/**
 * MT-006 — push subscription + in-app message reads/writes.
 *
 * The cleartext device token never leaves this module: reads return the masked
 * preview only.
 */
import { eq, and, isNull, desc, sql } from "drizzle-orm";
import { db, readScoped } from "../../shared/db.js";
import {
  pushSubscriptions,
  inAppMessages,
  type PushSubscriptionInsert,
  type PushSubscriptionRow,
  type InAppMessageInsert,
  type InAppMessageRow,
} from "./schema.js";
import { maskDeviceToken, type Platform, type SubscriptionView, type StoredSubscription } from "./domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

/**
 * Register (or re-activate) a subscription. Idempotent on
 * (tenant_id, user_id, token_hash): re-registering the same device on the same
 * user updates it instead of piling up duplicate rows.
 */
export async function upsertSubscription(tx: Writer, row: PushSubscriptionInsert): Promise<void> {
  await tx.insert(pushSubscriptions).values(row).onConflictDoUpdate({
    target: [pushSubscriptions.tenantId, pushSubscriptions.userId, pushSubscriptions.tokenHash],
    set: {
      platform: row.platform,
      deviceToken: row.deviceToken,
      endpoint: row.endpoint ?? null,
      userAgent: row.userAgent ?? null,
      enabled: true,
      revokedAt: null,
      updatedAt: new Date(),
      updatedBy: row.updatedBy,
    },
  });
}

export async function revokeSubscription(
  tx: Writer, tenantId: string, id: string, actorId: string,
): Promise<boolean> {
  const rows = await tx.select({ version: pushSubscriptions.version }).from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.id, id))).limit(1);
  const current = rows[0];
  if (!current) return false;
  await tx.update(pushSubscriptions).set({
    enabled: false, revokedAt: new Date(), updatedAt: new Date(),
    updatedBy: actorId, version: current.version + 1,
  }).where(and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.id, id)));
  return true;
}

export async function listSubscriptions(
  tenantId: string, userId: string, limit: number, offset: number,
): Promise<{ rows: SubscriptionView[]; total: number }> {
  return readScoped(tenantId, async (tx) => {
    const where = and(eq(pushSubscriptions.tenantId, tenantId), eq(pushSubscriptions.userId, userId));
    const rows = await tx.select().from(pushSubscriptions).where(where)
      .orderBy(desc(pushSubscriptions.createdAt)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(pushSubscriptions).where(where);
    return { rows: rows.map(toSubscriptionView), total: counted[0]?.n ?? 0 };
  });
}

/** Active subscriptions for a user — the send path's target set. */
export async function findActiveSubscriptions(
  tenantId: string, userId: string,
): Promise<StoredSubscription[]> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(pushSubscriptions)
    .where(and(
      eq(pushSubscriptions.tenantId, tenantId),
      eq(pushSubscriptions.userId, userId),
      eq(pushSubscriptions.enabled, true),
      isNull(pushSubscriptions.revokedAt),
    ))
    .orderBy(pushSubscriptions.createdAt));
  return rows.map((r) => ({
    id: r.id,
    platform: r.platform as Platform,
    enabled: r.enabled,
    tokenHash: r.tokenHash,
  }));
}

function toSubscriptionView(row: PushSubscriptionRow): SubscriptionView {
  return {
    id: row.id,
    platform: row.platform as Platform,
    enabled: row.enabled && row.revokedAt === null,
    tokenPreview: maskDeviceToken(row.deviceToken),
  };
}

export async function insertInAppMessage(tx: Writer, row: InAppMessageInsert): Promise<void> {
  await tx.insert(inAppMessages).values(row);
}

export async function markRead(
  tx: Writer, tenantId: string, userId: string, id: string, actorId: string,
): Promise<boolean> {
  const rows = await tx.select({ version: inAppMessages.version, readAt: inAppMessages.readAt })
    .from(inAppMessages)
    .where(and(
      eq(inAppMessages.tenantId, tenantId),
      eq(inAppMessages.userId, userId),
      eq(inAppMessages.id, id),
    )).limit(1);
  const current = rows[0];
  if (!current) return false;
  // Already read → nothing to change, but the message exists so this is a success.
  if (current.readAt !== null) return true;
  await tx.update(inAppMessages).set({
    readAt: new Date(), updatedAt: new Date(), updatedBy: actorId, version: current.version + 1,
  }).where(and(
    eq(inAppMessages.tenantId, tenantId),
    eq(inAppMessages.userId, userId),
    eq(inAppMessages.id, id),
  ));
  return true;
}

export type InAppMessageView = {
  id: string;
  title: string;
  body: string;
  severity: string;
  actionUrl: string | null;
  read: boolean;
  createdAt: string;
};

export async function listInAppMessages(
  tenantId: string, userId: string, limit: number, offset: number, unreadOnly: boolean,
): Promise<{ rows: InAppMessageView[]; total: number; unread: number }> {
  return readScoped(tenantId, async (tx) => {
    const base = and(eq(inAppMessages.tenantId, tenantId), eq(inAppMessages.userId, userId));
    const where = unreadOnly ? and(base, isNull(inAppMessages.readAt)) : base;
    const rows = await tx.select().from(inAppMessages).where(where)
      .orderBy(desc(inAppMessages.createdAt)).limit(limit).offset(offset);
    const counted = await tx.select({ n: sql<number>`count(*)::int` }).from(inAppMessages).where(where);
    const unreadCounted = await tx.select({ n: sql<number>`count(*)::int` })
      .from(inAppMessages).where(and(base, isNull(inAppMessages.readAt)));
    return {
      rows: rows.map(toMessageView),
      total: counted[0]?.n ?? 0,
      unread: unreadCounted[0]?.n ?? 0,
    };
  });
}

export async function findInAppMessage(
  tenantId: string, userId: string, id: string,
): Promise<InAppMessageRow | null> {
  const rows = await readScoped(tenantId, (tx) => tx.select().from(inAppMessages)
    .where(and(
      eq(inAppMessages.tenantId, tenantId),
      eq(inAppMessages.userId, userId),
      eq(inAppMessages.id, id),
    )).limit(1));
  return rows[0] ?? null;
}

function toMessageView(row: InAppMessageRow): InAppMessageView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    severity: row.severity,
    actionUrl: row.actionUrl,
    read: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}
