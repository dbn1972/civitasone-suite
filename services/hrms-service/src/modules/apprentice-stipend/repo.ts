import { eq, and, desc, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { HttpError } from "../../shared/context.js";
import {
  hrmsApprenticeships, hrmsApprenticeStipends,
  type ApprenticeshipRow, type ApprenticeshipInsert,
  type StipendRow, type StipendInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ---------------- apprenticeships ----------------
export async function insertApprenticeship(tx: Writer, row: ApprenticeshipInsert): Promise<void> {
  await tx.insert(hrmsApprenticeships).values(row);
}

export async function findApprenticeship(tenantId: string, id: string): Promise<ApprenticeshipRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsApprenticeships)
    .where(and(eq(hrmsApprenticeships.tenantId, tenantId), eq(hrmsApprenticeships.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listApprenticeships(tenantId: string, limit = 200): Promise<ApprenticeshipRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsApprenticeships)
    .where(eq(hrmsApprenticeships.tenantId, tenantId))
    .orderBy(desc(hrmsApprenticeships.createdAt)).limit(limit));
}

export async function updateApprenticeship(
  tx: Writer, tenantId: string, id: string, patch: Partial<ApprenticeshipInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsApprenticeships)
    .set({ ...patch, version: sql`${hrmsApprenticeships.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsApprenticeships.tenantId, tenantId), eq(hrmsApprenticeships.id, id), eq(hrmsApprenticeships.version, expectedVersion)));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "apprenticeship was modified by another request; reload and retry");
  }
}

// ---------------- stipends ----------------
export async function insertStipend(tx: Writer, row: StipendInsert): Promise<void> {
  await tx.insert(hrmsApprenticeStipends).values(row);
}

export async function findStipend(tenantId: string, id: string): Promise<StipendRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(hrmsApprenticeStipends)
    .where(and(eq(hrmsApprenticeStipends.tenantId, tenantId), eq(hrmsApprenticeStipends.id, id))).limit(1));
  return rows[0] ?? null;
}

export async function listStipendsByApprenticeship(tenantId: string, apprenticeshipId: string, limit = 200): Promise<StipendRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsApprenticeStipends)
    .where(and(eq(hrmsApprenticeStipends.tenantId, tenantId), eq(hrmsApprenticeStipends.apprenticeshipId, apprenticeshipId)))
    .orderBy(desc(hrmsApprenticeStipends.month)).limit(limit));
}

export async function listStipendsByStatus(tenantId: string, status: string, limit = 200): Promise<StipendRow[]> {
  return scopedRead((tx) => tx.select().from(hrmsApprenticeStipends)
    .where(and(eq(hrmsApprenticeStipends.tenantId, tenantId), eq(hrmsApprenticeStipends.status, status)))
    .orderBy(desc(hrmsApprenticeStipends.submittedAt)).limit(limit));
}

export async function updateStipend(
  tx: Writer, tenantId: string, id: string, patch: Partial<StipendInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsApprenticeStipends)
    .set({ ...patch, version: sql`${hrmsApprenticeStipends.version} + 1`, updatedAt: new Date() })
    .where(and(
      eq(hrmsApprenticeStipends.tenantId, tenantId),
      eq(hrmsApprenticeStipends.id, id),
      eq(hrmsApprenticeStipends.version, expectedVersion),
    ));
  if (((res as { rowCount?: number; count?: number }).rowCount ?? (res as { count?: number }).count ?? 0) === 0) {
    throw new HttpError(409, "VERSION_CONFLICT", "stipend run was modified by another request; reload and retry");
  }
}
