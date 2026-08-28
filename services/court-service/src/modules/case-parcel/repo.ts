import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { caseParcels } from "./schema.js";
import { normalizeSurvey } from "./domain.js";

/** Narrow write surface accepted for the transactional (GUC-scoped) path. */
export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export type CaseParcelRow    = typeof caseParcels.$inferSelect;
export type CaseParcelInsert = typeof caseParcels.$inferInsert;

export async function insertParcel(tx: Writer, row: CaseParcelInsert): Promise<void> {
  // Idempotent on the deterministic id: a redelivery (or a re-add of the same
  // case+survey+khasra) with the same id is a no-op.
  await tx.insert(caseParcels).values(row).onConflictDoNothing({ target: caseParcels.id });
}

export async function getParcelForUpdate(
  tx: Writer, tenantId: string, id: string,
): Promise<{ version: number; active: boolean } | undefined> {
  const rows = await tx.select({ version: caseParcels.version, active: caseParcels.active })
    .from(caseParcels)
    .where(and(eq(caseParcels.tenantId, tenantId), eq(caseParcels.id, id)))
    .limit(1);
  return rows[0];
}

/** Narrow, uncached read for a synchronous pre-check before publishing
 *  updateParcel -- same {version, active} column set as getParcelForUpdate
 *  (what the consumer reads inside its own tx). */
export async function getParcelForPrecheck(tenantId: string, id: string): Promise<{ version: number; active: boolean } | undefined> {
  const rows = await scopedRead<Array<{ version: number; active: boolean }>>((tx) => tx
    .select({ version: caseParcels.version, active: caseParcels.active })
    .from(caseParcels)
    .where(and(eq(caseParcels.tenantId, tenantId), eq(caseParcels.id, id)))
    .limit(1));
  return rows[0];
}

/** List every parcel attached to a case (most-recent first). RLS-scoped read. */
export async function listParcelsByCase(tenantId: string, caseId: string): Promise<CaseParcelRow[]> {
  return scopedRead<CaseParcelRow[]>((tx) => tx.select().from(caseParcels)
    .where(and(eq(caseParcels.tenantId, tenantId), eq(caseParcels.caseId, caseId)))
    .orderBy(desc(caseParcels.createdAt)));
}

/**
 * Reverse lookup powering "which cases involve this survey number": returns the
 * matching parcel rows (each carrying `case_id`) across ALL of the tenant's cases.
 * The survey number is normalized to match the normalized form stored on write.
 * RLS-scoped read.
 */
export async function searchBySurvey(
  tenantId: string, surveyNumber: string, limit: number, offset: number,
): Promise<CaseParcelRow[]> {
  const survey = normalizeSurvey(surveyNumber);
  return scopedRead<CaseParcelRow[]>((tx) => tx.select().from(caseParcels)
    .where(and(eq(caseParcels.tenantId, tenantId), eq(caseParcels.surveyNumber, survey)))
    .orderBy(desc(caseParcels.createdAt))
    .limit(limit)
    .offset(offset));
}
