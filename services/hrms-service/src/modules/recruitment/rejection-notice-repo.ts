import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsJobOpenings } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

/** The per-vacancy rejection-reason disclosure policy flag (defaults false). */
export async function getDisclosurePolicy(tenantId: string, jobOpeningId: string): Promise<boolean | null> {
  const rows = await scopedRead((tx) => tx.select({ v: hrmsJobOpenings.discloseRejectionReason }).from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, jobOpeningId))).limit(1));
  return rows[0] ? rows[0].v : null;
}

/**
 * Set the disclosure policy on a vacancy. Returns false when the vacancy is
 * absent. This is an idempotent boolean set (last-writer-wins is safe — two
 * writers setting the same value converge), so no optimistic-version guard is
 * needed here; the version bump preserves the row's audit lineage.
 */
export async function setDisclosurePolicy(
  tx: Writer, tenantId: string, jobOpeningId: string, disclose: boolean, actorId: string,
): Promise<boolean> {
  const res = await tx.update(hrmsJobOpenings)
    .set({ discloseRejectionReason: disclose, updatedBy: actorId, version: sql`${hrmsJobOpenings.version} + 1`, updatedAt: new Date() })
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, jobOpeningId)));
  return affected(res) > 0;
}
