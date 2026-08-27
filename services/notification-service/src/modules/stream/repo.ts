import { eq, and, isNull, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { notifications, type NotificationInsert, type NotificationRow } from "./schema.js";

/**
 * Persist a notification for offline recipients or history.
 * Uses a transaction to set tenant GUC for RLS.
 *
 * SEC: the `set_config('app.tenant_id', ..., true)` call below was previously
 * built via sql.raw() + raw string interpolation (no parameterization) — an
 * outlier compared to every other service in the fleet, which all set this
 * same GUC via the parameterized set_config() function form (e.g.
 * admin-service/config/repo.ts, contract-service, gateway-service/shared/
 * scope.ts, metadata-service/shared/scope.ts). set_config(...) is the
 * function-call equivalent of `SET LOCAL app.tenant_id = value` (Postgres
 * docs), so this is a behavior-preserving swap to the tagged-template form,
 * which drizzle-orm's sql`` binds as a real query parameter instead of
 * splicing it into the statement text. It is set inside the same
 * db.transaction() as the query it protects (`true` = SET LOCAL semantics)
 * because pgbouncer runs this DB in `transaction` pool_mode — a session-scoped
 * set_config would not reliably survive to the paired query on a pooled
 * connection.
 */
export async function persistNotification(data: NotificationInsert): Promise<NotificationRow> {
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${data.tenantId}, true)`);
    const rows = await tx.insert(notifications).values(data).returning();
    const row = rows[0];
    if (!row) throw new Error("Failed to insert notification");
    return row;
  });
  return result;
}

/**
 * Fetch unread notifications for a user (tenant-scoped), ordered by most recent first.
 * Used when a user connects to SSE to replay missed notifications.
 */
export async function listUnread(tenantId: string, userId: string, limit = 50): Promise<NotificationRow[]> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    return tx
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  });
}

/**
 * Mark a specific notification as read.
 */
export async function markRead(tenantId: string, userId: string, notificationId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    const result = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return result.length > 0;
  });
}

/**
 * Mark all unread notifications as read for a user.
 */
export async function markAllRead(tenantId: string, userId: string): Promise<number> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.tenant_id', ${tenantId}, true)`);
    const result = await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.tenantId, tenantId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      )
      .returning({ id: notifications.id });
    return result.length;
  });
}
