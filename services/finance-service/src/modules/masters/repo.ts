import { and, asc, eq } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { financePao, financeDdo, type PaoRow, type DdoRow } from "./schema.js";

export type Reader = Pick<typeof db, "select">;

export async function listPao(tenantId: string, limit = 500): Promise<PaoRow[]> {
  return scopedRead((tx) => tx.select().from(financePao)
    .where(eq(financePao.tenantId, tenantId))
    .orderBy(asc(financePao.paoCode))
    .limit(limit));
}

export async function listDdo(tenantId: string, limit = 500): Promise<DdoRow[]> {
  return scopedRead((tx) => tx.select().from(financeDdo)
    .where(eq(financeDdo.tenantId, tenantId))
    .orderBy(asc(financeDdo.ddoCode))
    .limit(limit));
}

export async function paoExists(tenantId: string, code: string, reader: Reader = db): Promise<boolean> {
  const r = reader as typeof db;
  const rows = await r.select({ id: financePao.id }).from(financePao)
    .where(and(eq(financePao.tenantId, tenantId), eq(financePao.paoCode, code), eq(financePao.isActive, true)))
    .limit(1);
  return rows.length > 0;
}

export async function ddoExists(tenantId: string, code: string, reader: Reader = db): Promise<boolean> {
  const r = reader as typeof db;
  const rows = await r.select({ id: financeDdo.id }).from(financeDdo)
    .where(and(eq(financeDdo.tenantId, tenantId), eq(financeDdo.ddoCode, code), eq(financeDdo.isActive, true)))
    .limit(1);
  return rows.length > 0;
}
