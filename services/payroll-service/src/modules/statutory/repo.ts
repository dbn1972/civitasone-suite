import { eq, and } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { payrollPf, payrollTds, payrollEsi, payrollGratuity, payrollGpf, payrollNps } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPf(tx: Writer, row: typeof payrollPf.$inferInsert): Promise<void> {
  await tx.insert(payrollPf).values(row);
}

export async function insertEsi(tx: Writer, row: typeof payrollEsi.$inferInsert): Promise<void> {
  await tx.insert(payrollEsi).values(row);
}

export async function insertTds(tx: Writer, row: typeof payrollTds.$inferInsert): Promise<void> {
  await tx.insert(payrollTds).values(row);
}

export async function insertGratuity(tx: Writer, row: typeof payrollGratuity.$inferInsert): Promise<void> {
  await tx.insert(payrollGratuity).values(row);
}

export async function insertGpf(tx: Writer, row: typeof payrollGpf.$inferInsert): Promise<void> {
  await tx.insert(payrollGpf).values(row);
}

export async function insertNps(tx: Writer, row: typeof payrollNps.$inferInsert): Promise<void> {
  await tx.insert(payrollNps).values(row);
}

export async function listPfByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollPf).where(eq(payrollPf.tenantId, tenantId)).limit(limit));
}

export async function listEsiByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollEsi).where(eq(payrollEsi.tenantId, tenantId)).limit(limit));
}

export async function listTdsByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollTds).where(eq(payrollTds.tenantId, tenantId)).limit(limit));
}

export async function listGratuityByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollGratuity).where(eq(payrollGratuity.tenantId, tenantId)).limit(limit));
}

export async function listGpfByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollGpf).where(eq(payrollGpf.tenantId, tenantId)).limit(limit));
}

export async function listNpsByTenant(tenantId: string, limit = 100) {
  return scopedRead((tx) => tx.select().from(payrollNps).where(eq(payrollNps.tenantId, tenantId)).limit(limit));
}

/**
 * Total EMPLOYER statutory contributions for a run (employer PF incl. EPS, employer
 * ESI, employer NPS), in paise. Used by finance to accrue the employer-cost legs.
 */
export async function sumEmployerContribByRun(runId: string, tenantId: string): Promise<bigint> {
  const sumOf = async (tbl: typeof payrollPf | typeof payrollEsi | typeof payrollNps): Promise<bigint> => {
    const rows = await scopedRead((tx) => tx.select({ v: tbl.erContribMinor }).from(tbl)
      .where(and(eq(tbl.runId, runId), eq(tbl.tenantId, tenantId))));
    return rows.reduce((s: bigint, r: { v: bigint }) => s + (r.v ?? 0n), 0n);
  };
  // payrollPf.erContribMinor is the full employer 12% (EPS + EPF-er); do not also
  // add epfErContribMinor or it double-counts.
  return (await sumOf(payrollPf)) + (await sumOf(payrollEsi)) + (await sumOf(payrollNps));
}

/**
 * Transaction-scoped variant of sumEmployerContribByRun, reading through the
 * caller's already-open `tx` instead of scopedRead's own nested
 * `db.transaction()`. payroll/consumer.ts's `runApprove` handler called the
 * scopedRead-based version from inside its own open transaction -- a second
 * transaction competing for a connection from the SAME pool as the outer one,
 * which deadlocks every in-flight approval once concurrent approvals reach
 * pool.max (the same bug class fixed in notification-service PR #1028 and
 * building-service PR #1035; see the production-readiness-audit skill,
 * .claude/skills/16-production-readiness-audit.md, section 1).
 */
export async function sumEmployerContribByRunTx(tx: Writer, runId: string, tenantId: string): Promise<bigint> {
  const sumOf = async (tbl: typeof payrollPf | typeof payrollEsi | typeof payrollNps): Promise<bigint> => {
    const rows = await tx.select({ v: tbl.erContribMinor }).from(tbl)
      .where(and(eq(tbl.runId, runId), eq(tbl.tenantId, tenantId)));
    return rows.reduce((s: bigint, r: { v: bigint }) => s + (r.v ?? 0n), 0n);
  };
  return (await sumOf(payrollPf)) + (await sumOf(payrollEsi)) + (await sumOf(payrollNps));
}
