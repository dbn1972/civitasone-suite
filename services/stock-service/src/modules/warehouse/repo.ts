import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { scopedRead } from "../../shared/db.js";
import { stockWarehouses, type WarehouseRow } from "./schema.js";

const likeEscape = (v: string): string => v.replace(/[\\%_]/g, (m) => `\\${m}`);

export type WarehouseListOpts = { q?: string; activeOnly?: boolean; limit?: number; offset?: number };

/** Tenant-scoped warehouse list for pickers (GAP-STOCK-LEDGER-NEW-01). Stable order: name, id. */
export async function findWarehousesByTenant(tenantId: string, opts: WarehouseListOpts = {}): Promise<WarehouseRow[]> {
  const conds: SQL[] = [eq(stockWarehouses.tenantId, tenantId)];
  if (opts.activeOnly) conds.push(eq(stockWarehouses.isActive, true));
  if (opts.q) {
    const pat = `%${likeEscape(opts.q)}%`;
    conds.push(sql`(${stockWarehouses.name} ILIKE ${pat} ESCAPE '\\' OR ${stockWarehouses.code} ILIKE ${pat} ESCAPE '\\')`);
  }
  return runWithTenant(tenantId, () => scopedRead(async (tx) =>
    tx.select().from(stockWarehouses)
      .where(and(...conds))
      .orderBy(asc(stockWarehouses.name), asc(stockWarehouses.id))
      .limit(opts.limit ?? 100)
      .offset(opts.offset ?? 0)
  ));
}
