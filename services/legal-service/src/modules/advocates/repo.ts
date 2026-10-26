import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { empanelledAdvocates, type AdvocateRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function listAdvocates(tenantId: string): Promise<AdvocateRow[]> {
  return db.transaction((tx) => tx.select().from(empanelledAdvocates)
    .where(eq(empanelledAdvocates.tenantId, tenantId)).orderBy(asc(empanelledAdvocates.name)).limit(1000));
}

export async function findAdvocateById(tenantId: string, id: string): Promise<AdvocateRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(empanelledAdvocates)
    .where(and(eq(empanelledAdvocates.tenantId, tenantId), eq(empanelledAdvocates.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function findAdvocateByBarNo(tenantId: string, barEnrolmentNo: string): Promise<AdvocateRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(empanelledAdvocates)
    .where(and(
      eq(empanelledAdvocates.tenantId, tenantId),
      sql`lower(btrim(${empanelledAdvocates.barEnrolmentNo})) = lower(btrim(${barEnrolmentNo}))`,
    )).limit(1));
  return rows[0] ?? null;
}

export async function insertAdvocate(tx: Writer, row: typeof empanelledAdvocates.$inferInsert): Promise<void> {
  await tx.insert(empanelledAdvocates).values(row);
}
