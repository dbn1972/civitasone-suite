import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { financeOffices, type OfficeRow } from "./office-schema.js";

/** id -> office name for the given ids (tenant-scoped). Unknown ids are simply absent. */
export async function officeNamesByIds(tenantId: string, ids: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await scopedRead((tx) => tx.select({ id: financeOffices.id, name: financeOffices.name })
    .from(financeOffices).where(and(eq(financeOffices.tenantId, tenantId), inArray(financeOffices.id, unique))));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export async function listOffices(tenantId: string, limit: number, offset: number): Promise<{ rows: OfficeRow[]; total: number }> {
  return scopedRead(async (tx) => {
    const rows = await tx.select().from(financeOffices).where(eq(financeOffices.tenantId, tenantId))
      .orderBy(asc(financeOffices.name), asc(financeOffices.id)).limit(limit).offset(offset);
    const [c] = await tx.select({ n: sql<number>`count(*)::int` }).from(financeOffices).where(eq(financeOffices.tenantId, tenantId));
    return { rows, total: c?.n ?? 0 };
  });
}

export async function findOfficeByCode(tenantId: string, code: string): Promise<OfficeRow | null> {
  const rows = await scopedRead((tx) => tx.select().from(financeOffices)
    .where(and(eq(financeOffices.tenantId, tenantId), eq(financeOffices.code, code))).limit(1));
  return rows[0] ?? null;
}
