/**
 * Quarters read queries — tenant-scoped via db.transaction() for RLS.
 */
import { eq, and, type SQL } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  estabQuarters, estabQuarterAllotments, estabLicenceFeeRates,
  type QuarterRow, type AllotmentRow, type LicenceFeeRateRow,
} from "./schema.js";

export async function getQuarter(tenantId: string, id: string): Promise<QuarterRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(estabQuarters)
    .where(and(eq(estabQuarters.id, id), eq(estabQuarters.tenantId, tenantId))).limit(1));
  return rows[0] ?? null;
}

export async function listQuarters(
  tenantId: string,
  opts: { status?: string; type?: string; limit: number; offset: number },
): Promise<QuarterRow[]> {
  const conds: SQL[] = [eq(estabQuarters.tenantId, tenantId)];
  if (opts.status) conds.push(eq(estabQuarters.status, opts.status));
  if (opts.type) conds.push(eq(estabQuarters.quarterType, opts.type));
  return db.transaction((tx) => tx.select().from(estabQuarters)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function listAllotments(
  tenantId: string,
  opts: { status?: string; limit: number; offset: number },
): Promise<AllotmentRow[]> {
  const conds: SQL[] = [eq(estabQuarterAllotments.tenantId, tenantId)];
  if (opts.status) conds.push(eq(estabQuarterAllotments.status, opts.status));
  return db.transaction((tx) => tx.select().from(estabQuarterAllotments)
    .where(and(...conds)).limit(opts.limit).offset(opts.offset));
}

export async function listLicenceFeeRates(tenantId: string): Promise<LicenceFeeRateRow[]> {
  return db.transaction((tx) => tx.select().from(estabLicenceFeeRates)
    .where(eq(estabLicenceFeeRates.tenantId, tenantId)));
}
