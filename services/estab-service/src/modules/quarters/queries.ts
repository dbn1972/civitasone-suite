/**
 * Quarters read queries — tenant-scoped via db.transaction() for RLS.
 */
import { eq, and, inArray, count, desc, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  estabQuarters, estabQuarterAllotments, estabLicenceFeeRates,
  type QuarterRow, type AllotmentRow, type LicenceFeeRateRow,
} from "./schema.js";
import { getEmployeeDisplayMap } from "../../shared/hrms-client.js";

/**
 * An allotment row enriched with the best-effort employee display name
 * (UX-021) and the human quarter number (GAP-ESTAB-QUARTERS-ALLOTMENTS-01).
 * `quarterNo` lets the UI show "B-204" instead of a truncated quarterId UUID;
 * it is resolved from the SAME-module `estab_quarters` table (both live in the
 * `quarters` PG schema, so this is an in-module read, not a cross-module/
 * cross-service JOIN). null only if the referenced quarter row is missing.
 */
export type AllotmentListRow = AllotmentRow & {
  employeeName: string | null;
  quarterNo: string | null;
};

export async function getQuarter(tenantId: string, id: string): Promise<QuarterRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabQuarters)
    .where(and(eq(estabQuarters.id, id), eq(estabQuarters.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listQuarters(
  tenantId: string,
  opts: { status?: string | undefined; type?: string | undefined; limit: number; offset: number },
): Promise<QuarterRow[]> {
  const conds: SQL[] = [eq(estabQuarters.tenantId, tenantId)];
  if (opts.status) conds.push(eq(estabQuarters.status, opts.status));
  if (opts.type) conds.push(eq(estabQuarters.quarterType, opts.type));
  return db.transaction((tx) => tx.select().from(estabQuarters)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

/**
 * GAP-ESTAB-QUARTERS-01: tenant-wide quarter counts by status plus the grand
 * total, computed in the DB (NOT by counting a capped page of rows), so the UI
 * stat tiles are correct on a large estate and reconcile to the total. The web
 * tiles can then show every status (any status not in its named tiles rolls up
 * into an "Other" figure derived from total − named).
 */
export async function getQuarterSummary(
  tenantId: string,
): Promise<{ total: number; byStatus: Record<string, number> }> {
  const rows = await db.transaction((tx) =>
    tx.select({ status: estabQuarters.status, n: count() })
      .from(estabQuarters)
      .where(eq(estabQuarters.tenantId, tenantId))
      .groupBy(estabQuarters.status),
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n);
    byStatus[r.status] = n;
    total += n;
  }
  return { total, byStatus };
}

/** Resolve a set of quarter ids to their quarter numbers (in-module read). */
async function resolveQuarterNos(tenantId: string, quarterIds: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(quarterIds)];
  if (unique.length === 0) return new Map();
  const rows = await db.transaction((tx) => tx
    .select({ id: estabQuarters.id, quarterNo: estabQuarters.quarterNo })
    .from(estabQuarters)
    .where(and(eq(estabQuarters.tenantId, tenantId), inArray(estabQuarters.id, unique))));
  return new Map(rows.map((r) => [r.id, r.quarterNo]));
}

/**
 * GAP-ESTAB-QUARTERS-DETAIL-01 + ALLOTMENTS-01: list allotments, optionally
 * filtered to a single quarter (so the quarter-detail history page no longer
 * over-fetches the whole estate), enriched with the employee display name
 * (UX-021) and the human quarter number. Returns `total` so the UI can show a
 * "Showing N of M" truncation notice.
 */
export async function listAllotments(
  tenantId: string,
  opts: { status?: string | undefined; quarterId?: string | undefined; limit: number; offset: number },
): Promise<{ rows: AllotmentListRow[]; total: number }> {
  const conds: SQL[] = [eq(estabQuarterAllotments.tenantId, tenantId)];
  if (opts.status) conds.push(eq(estabQuarterAllotments.status, opts.status));
  if (opts.quarterId) conds.push(eq(estabQuarterAllotments.quarterId, opts.quarterId));
  const [rows, totalRows, employees] = await Promise.all([
    db.transaction((tx) => tx.select().from(estabQuarterAllotments)
      .where(and(...conds)).limit(opts.limit).offset(opts.offset)),
    db.transaction((tx) => tx.select({ n: count() }).from(estabQuarterAllotments).where(and(...conds))),
    // UX-021: same best-effort, cached, tenant-scoped hrms lookup
    // modules/files/queries.ts#officerLabel already uses for the officer-
    // of-record display problem -- see hrms-client.ts. Never
    // throws/blocks: an hrms-service outage degrades every row to
    // employeeRef truncation at the frontend, it never breaks the read.
    getEmployeeDisplayMap(tenantId),
  ]);
  const quarterNos = await resolveQuarterNos(tenantId, rows.map((r) => r.quarterId));
  return {
    rows: rows.map((r) => ({
      ...r,
      employeeName: employees.get(r.employeeRef)?.fullName ?? null,
      quarterNo: quarterNos.get(r.quarterId) ?? null,
    })),
    total: Number(totalRows[0]?.n ?? 0),
  };
}

/**
 * GAP-ESTAB-QUARTERS-ALLOTMENTS-DETAIL-02: fetch a single allotment by id,
 * enriched like the list. Lets the detail page load an allotment directly
 * instead of fetching the whole list and `.find()`-ing (which wrongly 404s any
 * allotment outside the first page and over-fetches the estate per view).
 */
export async function getAllotment(tenantId: string, id: string): Promise<AllotmentListRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabQuarterAllotments)
    .where(and(eq(estabQuarterAllotments.id, id), eq(estabQuarterAllotments.tenantId, tenantId))).limit(1));
  const row = rows[0];
  if (!row) return null;
  const [employees, quarterNos] = await Promise.all([
    getEmployeeDisplayMap(tenantId),
    resolveQuarterNos(tenantId, [row.quarterId]),
  ]);
  return {
    ...row,
    employeeName: employees.get(row.employeeRef)?.fullName ?? null,
    quarterNo: quarterNos.get(row.quarterId) ?? null,
  };
}

export async function listLicenceFeeRates(
  tenantId: string,
  opts: { limit: number; offset: number } = { limit: 50, offset: 0 },
): Promise<LicenceFeeRateRow[]> {
  return db.transaction((tx) => tx.select().from(estabLicenceFeeRates)
    .where(eq(estabLicenceFeeRates.tenantId, tenantId))
    .orderBy(desc(estabLicenceFeeRates.effectiveFrom))
    .limit(opts.limit).offset(opts.offset));
}

/**
 * Pre-check for the 0049 exclusion constraint: is there an existing rate for the
 * same (tenant, quarter type, pay level) whose inclusive [from, to] range
 * overlaps the candidate's? Lets the route refuse synchronously (409) instead
 * of the async consumer dropping the write.
 */
export async function findOverlappingLicenceFeeRate(
  tenantId: string, quarterType: string, payLevel: string, effectiveFrom: string, effectiveTo?: string,
): Promise<LicenceFeeRateRow | undefined> {
  const rows = await db.transaction((tx) => tx.select().from(estabLicenceFeeRates)
    .where(and(
      eq(estabLicenceFeeRates.tenantId, tenantId),
      eq(estabLicenceFeeRates.quarterType, quarterType),
      eq(estabLicenceFeeRates.payLevel, payLevel),
    )));
  const to = effectiveTo ?? "9999-12-31";
  return rows.find((r) => r.effectiveFrom <= to && (r.effectiveTo ?? "9999-12-31") >= effectiveFrom);
}
