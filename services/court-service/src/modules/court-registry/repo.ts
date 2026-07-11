import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { courts, benches } from "./schema.js";

/** Narrow write surface accepted for the transactional (GUC-scoped) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type CourtRow    = typeof courts.$inferSelect;
export type CourtInsert = typeof courts.$inferInsert;
export type BenchRow    = typeof benches.$inferSelect;
export type BenchInsert = typeof benches.$inferInsert;

export async function insertCourt(tx: Writer, row: CourtInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery with the same id is a no-op.
  await tx.insert(courts).values(row).onConflictDoNothing({ target: courts.id });
}

export async function insertBench(tx: Writer, row: BenchInsert): Promise<void> {
  await tx.insert(benches).values(row).onConflictDoNothing({ target: benches.id });
}

export async function listCourts(
  filters: { tenantId: string; courtType?: string | undefined; parentCourtId?: string | undefined },
  limit: number,
  offset: number,
): Promise<CourtRow[]> {
  const predicates = [eq(courts.tenantId, filters.tenantId)];
  if (filters.courtType) predicates.push(eq(courts.courtType, filters.courtType));
  if (filters.parentCourtId) predicates.push(eq(courts.parentCourtId, filters.parentCourtId));
  return scopedRead((tx) => tx.select().from(courts)
    .where(and(...predicates))
    .orderBy(desc(courts.createdAt))
    .limit(limit)
    .offset(offset));
}

export async function getCourtById(tenantId: string, id: string): Promise<CourtRow | undefined> {
  const rows = await scopedRead<CourtRow[]>((tx) => tx.select().from(courts)
    .where(and(eq(courts.tenantId, tenantId), eq(courts.id, id)))
    .limit(1));
  return rows[0];
}

export async function listBenchesByCourt(tenantId: string, courtId: string): Promise<BenchRow[]> {
  return scopedRead((tx) => tx.select().from(benches)
    .where(and(eq(benches.tenantId, tenantId), eq(benches.courtId, courtId)))
    .orderBy(desc(benches.createdAt)));
}
