/**
 * routes/repo.ts — Database operations for route plans.
 */
import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { routePlans, type RoutePlanRow, type RoutePlanInsert } from "./schema.js";

export function toView(r: RoutePlanRow) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    assigneeId: r.assigneeId,
    routeDate: r.routeDate,
    status: r.status,
    waypoints: r.waypoints,
    optimizedOrder: r.optimizedOrder,
    totalDistanceKm: r.totalDistanceKm,
    estimatedDurationMinutes: r.estimatedDurationMinutes,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type RoutePlanView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<RoutePlanRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(routePlans).where(and(eq(routePlans.id, id), eq(routePlans.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function findByAssigneeAndDate(
  assigneeId: string,
  routeDate: string,
  tenantId: string,
): Promise<RoutePlanRow | null> {
  const rows = await scopedRead((tx) =>
    tx
      .select()
      .from(routePlans)
      .where(
        and(
          eq(routePlans.assigneeId, assigneeId),
          eq(routePlans.routeDate, routeDate),
          eq(routePlans.tenantId, tenantId),
        ),
      )
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listByTenant(
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: RoutePlanRow[]; total: number }> {
  const where = eq(routePlans.tenantId, tenantId);

  const rows = await scopedRead((tx) =>
    tx.select().from(routePlans).where(where).orderBy(desc(routePlans.routeDate)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(routePlans).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: RoutePlanInsert): Promise<void> {
  await tx.insert(routePlans).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<RoutePlanInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(routePlans)
    .set({ ...patch, updatedAt: new Date(), version: sql`${routePlans.version} + 1` })
    .where(and(eq(routePlans.id, id), eq(routePlans.tenantId, tenantId), eq(routePlans.version, currentVersion)))
    .returning({ id: routePlans.id });
  return result.length > 0;
}
