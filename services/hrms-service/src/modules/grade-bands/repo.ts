/**
 * S8-G4 -- reads/writes behind /v1/hrms/admin/grade-bands. Reads take a transaction-like handle so the
 * consumer can run them inside its own transaction (a nested scopedRead() inside db.transaction()
 * deadlocks the pool -- see employee/repo.ts); routes pass the scopedRead tx.
 */
import { and, asc, eq, sql } from "drizzle-orm";
import type { db } from "../../shared/db.js";
import { hrmsGradeBands, hrmsDesignations } from "../employee/schema.js";

export type Reader = Pick<typeof db, "select">;
export type Writer = Pick<typeof db, "insert" | "update" | "delete" | "select">;
export type GradeBandRow = typeof hrmsGradeBands.$inferSelect;

/** What the API returns: money as strings (bigint is not JSON). */
export function toDto(r: GradeBandRow, designationCount?: number) {
  return {
    id: r.id, code: r.code, name: r.name, rank: r.rank, track: r.track,
    ctcMinMinor: r.ctcMinMinor === null ? null : r.ctcMinMinor.toString(),
    ctcMaxMinor: r.ctcMaxMinor === null ? null : r.ctcMaxMinor.toString(),
    noticeDays: r.noticeDays, isActive: r.isActive, version: r.version,
    createdAt: r.createdAt, updatedAt: r.updatedAt,
    ...(designationCount === undefined ? {} : { designationCount }),
  };
}

export async function listBands(tx: Reader, tenantId: string, includeInactive: boolean) {
  const where = includeInactive
    ? eq(hrmsGradeBands.tenantId, tenantId)
    : and(eq(hrmsGradeBands.tenantId, tenantId), eq(hrmsGradeBands.isActive, true));
  const rows = await tx.select().from(hrmsGradeBands).where(where).orderBy(asc(hrmsGradeBands.rank), asc(hrmsGradeBands.code));
  const counts = await tx.select({ id: hrmsDesignations.gradeBandId, n: sql<number>`count(*)::int` })
    .from(hrmsDesignations).where(and(eq(hrmsDesignations.tenantId, tenantId), sql`${hrmsDesignations.gradeBandId} is not null`))
    .groupBy(hrmsDesignations.gradeBandId);
  const byBand = new Map(counts.map((c) => [c.id as string, c.n]));
  return rows.map((r) => toDto(r, byBand.get(r.id) ?? 0));
}

export async function findBand(tx: Reader, tenantId: string, id: string): Promise<GradeBandRow | null> {
  const rows = await tx.select().from(hrmsGradeBands)
    .where(and(eq(hrmsGradeBands.tenantId, tenantId), eq(hrmsGradeBands.id, id))).limit(1);
  return rows[0] ?? null;
}

export async function findBandByCode(tx: Reader, tenantId: string, code: string): Promise<GradeBandRow | null> {
  const rows = await tx.select().from(hrmsGradeBands)
    .where(and(eq(hrmsGradeBands.tenantId, tenantId), eq(hrmsGradeBands.code, code))).limit(1);
  return rows[0] ?? null;
}

export async function countDesignationsOnBand(tx: Reader, tenantId: string, bandId: string): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(hrmsDesignations)
    .where(and(eq(hrmsDesignations.tenantId, tenantId), eq(hrmsDesignations.gradeBandId, bandId)));
  return r?.n ?? 0;
}
