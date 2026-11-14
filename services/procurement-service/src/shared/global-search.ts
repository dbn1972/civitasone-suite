/**
 * Procurement -> cross-module search (indents, purchase orders). Re-reads one row in the caller's write transaction and
 * publishes an upsert through the outbox. Flag off for the tenant => returns before any query.
 * Indexed: number, status and a short non-personal descriptor. Never amounts, vendor bank/PAN details or item lines.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { syncGlobalRecord, type BackfillEntity, type DrizzleTx, type SearchableFields } from "@civitasone/search";
import { procurementIndents } from "../modules/indent/schema.js";
import { procurementPos } from "../modules/po/schema.js";
import type { db } from "./db.js";

type Reader = Pick<typeof db, "select">;
const asTx = (tx: Reader): DrizzleTx => tx as unknown as DrizzleTx;

const indentCols = {
  id: procurementIndents.id, tenantId: procurementIndents.tenantId, updatedBy: procurementIndents.updatedBy, indentNo: procurementIndents.indentNo,
  department: procurementIndents.department, purpose: procurementIndents.purpose, status: procurementIndents.status,
};
const indentFields = (r: { indentNo: string; department: string; purpose: string; status: string }): SearchableFields => ({
  title: `Indent ${r.indentNo}`, refNumber: r.indentNo, status: r.status, summary: `${r.department} · ${r.purpose}`,
});
const poCols = {
  id: procurementPos.id, tenantId: procurementPos.tenantId, updatedBy: procurementPos.updatedBy, poNo: procurementPos.poNo,
  orderType: procurementPos.orderType, indentRef: procurementPos.indentRef, status: procurementPos.status,
};
const poFields = (r: { poNo: string; orderType: string; indentRef: string; status: string }): SearchableFields => ({
  title: `${r.orderType === "service" ? "Work order" : "Purchase order"} ${r.poNo}`, refNumber: r.poNo, status: r.status, summary: `Indent ${r.indentRef}`,
});

export async function syncIndent(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: asTx(tx), entityType: "procurement.indent", entityId: id, tenantId,
    load: async () => (await tx.select(indentCols).from(procurementIndents)
      .where(tenantId ? and(eq(procurementIndents.id, id), eq(procurementIndents.tenantId, tenantId)) : eq(procurementIndents.id, id)).limit(1))[0],
    toRecord: indentFields,
  });
}

export async function syncPo(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: asTx(tx), entityType: "procurement.po", entityId: id, tenantId,
    load: async () => (await tx.select(poCols).from(procurementPos)
      .where(tenantId ? and(eq(procurementPos.id, id), eq(procurementPos.tenantId, tenantId)) : eq(procurementPos.id, id)).limit(1))[0],
    toRecord: poFields,
  });
}

/** Backfill sources (keyset on id). `withTenant` must run `fn` in a transaction that carries the tenant GUC (RLS). */
export function backfillEntities(tenantId: string, withTenant: <T>(fn: (tx: Reader) => Promise<T>) => Promise<T>): BackfillEntity[] {
  return [
    {
      entityType: "procurement.indent",
      source: {
        tenantId, idOf: (r: { id: string }) => r.id,
        fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(indentCols).from(procurementIndents)
          .where(and(eq(procurementIndents.tenantId, tenantId), after ? gt(procurementIndents.id, after) : undefined)).orderBy(asc(procurementIndents.id)).limit(size)),
        toRecord: (r: Parameters<typeof indentFields>[0] & { id: string }) => ({ ...indentFields(r), entityType: "procurement.indent" as const, entityId: r.id, tenantId }),
      },
    },
    {
      entityType: "procurement.po",
      source: {
        tenantId, idOf: (r: { id: string }) => r.id,
        fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(poCols).from(procurementPos)
          .where(and(eq(procurementPos.tenantId, tenantId), after ? gt(procurementPos.id, after) : undefined)).orderBy(asc(procurementPos.id)).limit(size)),
        toRecord: (r: Parameters<typeof poFields>[0] & { id: string }) => ({ ...poFields(r), entityType: "procurement.po" as const, entityId: r.id, tenantId }),
      },
    },
  ];
}
