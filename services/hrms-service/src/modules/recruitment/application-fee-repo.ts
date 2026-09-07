import { eq, and, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { hrmsJobOpenings, hrmsApplicationFees, type ApplicationFeeRow, type ApplicationFeeInsert } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

function affected(res: unknown): number {
  const r = res as { rowCount?: number; count?: number };
  return r.rowCount ?? r.count ?? 0;
}

/** The vacancy's fee (paise) — null when no fee is configured. */
export async function getVacancyFee(tenantId: string, jobOpeningId: string): Promise<bigint | null> {
  return scopedRead((tx) => getVacancyFeeTx(tx, tenantId, jobOpeningId));
}

/** Tx-scoped variant of getVacancyFee -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function getVacancyFeeTx(tx: Writer, tenantId: string, jobOpeningId: string): Promise<bigint | null> {
  const rows = await (tx as typeof db).select({ fee: hrmsJobOpenings.feesMinor }).from(hrmsJobOpenings)
    .where(and(eq(hrmsJobOpenings.tenantId, tenantId), eq(hrmsJobOpenings.id, jobOpeningId))).limit(1);
  return rows[0] ? (rows[0].fee ?? null) : null;
}

export async function findFee(tenantId: string, applicationId: string): Promise<ApplicationFeeRow | null> {
  return scopedRead((tx) => findFeeTx(tx, tenantId, applicationId));
}

/** Tx-scoped variant of findFee -- see .claude/skills/16-production-readiness-audit.md section 1. */
export async function findFeeTx(tx: Writer, tenantId: string, applicationId: string): Promise<ApplicationFeeRow | null> {
  const rows = await (tx as typeof db).select().from(hrmsApplicationFees)
    .where(and(eq(hrmsApplicationFees.tenantId, tenantId), eq(hrmsApplicationFees.applicationId, applicationId))).limit(1);
  return rows[0] ?? null;
}

export async function insertFee(tx: Writer, row: ApplicationFeeInsert): Promise<void> {
  await tx.insert(hrmsApplicationFees).values(row);
}

/** Update a fee record under an optimistic-version guard. Throws VERSION_CONFLICT on miss. */
export async function updateFee(
  tx: Writer, tenantId: string, id: string, patch: Partial<ApplicationFeeInsert>, expectedVersion: number,
): Promise<void> {
  const res = await tx.update(hrmsApplicationFees)
    .set({ ...patch, version: expectedVersion + 1, updatedAt: new Date() })
    .where(and(
      eq(hrmsApplicationFees.tenantId, tenantId),
      eq(hrmsApplicationFees.id, id),
      eq(hrmsApplicationFees.version, expectedVersion),
    ));
  if (affected(res) === 0) throw new Error("VERSION_CONFLICT");
}
