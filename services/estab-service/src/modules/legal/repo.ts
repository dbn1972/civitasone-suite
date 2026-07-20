import { eq } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { estabCourtCases, estabCaseDates, estabRtiRequests } from "./schema.js";
import type { CourtCaseInsert, CaseDateInsert, RtiInsert, RtiRow, CourtCaseRow } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findRtiById(id: string): Promise<RtiRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabRtiRequests).where(eq(estabRtiRequests.id, id)).limit(1));
  return rows[0] ?? null;
}

// Wrapped in db.transaction() so wrapWithTenantGuc injects app.tenant_id
// before this read — a bare db.select() runs with no RLS GUC set.
export async function findCourtCaseById(id: string): Promise<CourtCaseRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabCourtCases).where(eq(estabCourtCases.id, id)).limit(1));
  return rows[0] ?? null;
}

export async function insertCourtCase(tx: Writer, row: CourtCaseInsert): Promise<void> {
  await tx.insert(estabCourtCases).values(row);
}

export async function insertCaseDate(tx: Writer, row: CaseDateInsert): Promise<void> {
  await tx.insert(estabCaseDates).values(row);
}

export async function updateCourtCase(tx: Writer, id: string, patch: Partial<CourtCaseInsert>): Promise<void> {
  await tx.update(estabCourtCases).set({ ...patch, updatedAt: new Date() }).where(eq(estabCourtCases.id, id));
}

export async function insertRti(tx: Writer, row: RtiInsert): Promise<void> {
  await tx.insert(estabRtiRequests).values(row);
}

export async function updateRti(tx: Writer, id: string, patch: Partial<RtiInsert>): Promise<void> {
  await tx.update(estabRtiRequests).set({ ...patch, updatedAt: new Date() }).where(eq(estabRtiRequests.id, id));
}
