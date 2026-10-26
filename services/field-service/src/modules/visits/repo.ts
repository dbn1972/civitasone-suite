/**
 * visits/repo.ts — Database operations for visit logs.
 */
import { eq, and, sql, desc, gte, lt, type SQL } from "drizzle-orm";
import { db, scopedRead, type ScopedTx } from "../../shared/db.js";
import { visits, type VisitRow, type VisitInsert } from "./schema.js";

/** Coordinates are shown rounded to this many decimals (about 110 m): owner decision #35. */
const COORD_DECIMALS = 3;

/** Round a stored numeric coordinate string to 3dp; null in, null out. */
function roundCoord(v: string | null): string | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(COORD_DECIMALS) : null;
}

/**
 * GAP-FIELD-VISITS-03 / owner decision #35: full-precision GPS never leaves the
 * server. Permitted roles (canSeeLocation) get 3dp-rounded coordinates; every
 * other caller gets null coordinates. Defaults to the redacted (no-location) view.
 */
export function toView(r: VisitRow, canSeeLocation = false) {
  return {
    id: r.id,
    tenantId: r.tenantId,
    taskId: r.taskId,
    agentId: r.agentId,
    checkInLatitude: canSeeLocation ? roundCoord(r.checkInLatitude) : null,
    checkInLongitude: canSeeLocation ? roundCoord(r.checkInLongitude) : null,
    checkOutLatitude: canSeeLocation ? roundCoord(r.checkOutLatitude) : null,
    checkOutLongitude: canSeeLocation ? roundCoord(r.checkOutLongitude) : null,
    checkInAt: r.checkInAt?.toISOString() ?? null,
    checkOutAt: r.checkOutAt?.toISOString() ?? null,
    durationMinutes: r.durationMinutes,
    outcome: r.outcome,
    notes: r.notes,
    photos: r.photos,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    version: r.version,
  };
}

export type VisitView = ReturnType<typeof toView>;

export async function findById(id: string, tenantId: string): Promise<VisitRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(visits).where(and(eq(visits.id, id), eq(visits.tenantId, tenantId))).limit(1),
  );
  return rows[0] ?? null;
}

export async function findByTaskId(
  taskId: string,
  tenantId: string,
  limit: number,
  offset: number,
  agentId?: string,
): Promise<{ rows: VisitRow[]; total: number }> {
  const where = agentId
    ? and(eq(visits.taskId, taskId), eq(visits.tenantId, tenantId), eq(visits.agentId, agentId))
    : and(eq(visits.taskId, taskId), eq(visits.tenantId, tenantId));

  const rows = await scopedRead((tx) =>
    tx.select().from(visits).where(where).orderBy(desc(visits.checkInAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(visits).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function findByAgent(
  agentId: string,
  tenantId: string,
  limit: number,
  offset: number,
): Promise<{ rows: VisitRow[]; total: number }> {
  const where = and(eq(visits.agentId, agentId), eq(visits.tenantId, tenantId));

  const rows = await scopedRead((tx) =>
    tx.select().from(visits).where(where).orderBy(desc(visits.checkInAt)).limit(limit).offset(offset),
  );

  const countResult = await scopedRead((tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(visits).where(where),
  );
  const total = countResult[0]?.count ?? 0;

  return { rows, total };
}

export async function insert(tx: ScopedTx, row: VisitInsert): Promise<void> {
  await tx.insert(visits).values(row);
}

export async function update(
  tx: ScopedTx,
  id: string,
  tenantId: string,
  patch: Partial<VisitInsert>,
  currentVersion: number,
): Promise<boolean> {
  const result = await tx
    .update(visits)
    .set({ ...patch, updatedAt: new Date(), version: sql`${visits.version} + 1` })
    .where(and(eq(visits.id, id), eq(visits.tenantId, tenantId), eq(visits.version, currentVersion)))
    .returning({ id: visits.id });
  return result.length > 0;
}

/** Recent visits for the tenant, newest check-in first (P1-10 FE list). */
export async function listRecent(
  tenantId: string,
  limit: number,
  offset: number,
  agentId?: string,
  range?: { from?: Date; toExclusive?: Date },
): Promise<{ rows: VisitRow[]; total: number }> {
  const conds: SQL[] = [eq(visits.tenantId, tenantId)];
  if (agentId) conds.push(eq(visits.agentId, agentId));
  if (range?.from) conds.push(gte(visits.checkInAt, range.from));
  if (range?.toExclusive) conds.push(lt(visits.checkInAt, range.toExclusive));
  const where = and(...conds);
  const rows = await scopedRead((tx) =>
    tx.select().from(visits)
      .where(where)
      .orderBy(desc(visits.checkInAt))
      .limit(limit)
      .offset(offset),
  );
  const counted = await scopedRead((tx) =>
    tx.select({ total: sql<number>`count(*)::int` }).from(visits).where(where),
  );
  return { rows, total: counted[0]?.total ?? 0 };
}
