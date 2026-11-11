/**
 * Finance -> cross-module search. Each sync helper re-reads ONE row inside the caller's write transaction and publishes
 * an upsert/delete through the outbox (see @civitasone/search syncGlobalRecord). Only non-personal columns are selected:
 * vendor PAN, GSTIN, address, phone, e-mail and bank details are never read here, let alone indexed.
 *
 * Flag off for the tenant => the helper returns before any query (flag-off parity).
 * Sample bills (is_sample) are demo data and are never indexed.
 * The same column lists and row mappers feed the backfill (backfillEntities), so live and backfilled documents match.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { syncGlobalRecord, type BackfillEntity, type DrizzleTx, type SearchableFields } from "@civitasone/search";
import { financeBills } from "../modules/payments/schema.js";
import { financeVendors } from "../modules/masters/schema.js";
import { financeJournals } from "../modules/gl/schema.js";
import type { db } from "./db.js";

type Reader = Pick<typeof db, "select">;
const asTx = (tx: Reader): DrizzleTx => tx as unknown as DrizzleTx;

const billCols = {
  id: financeBills.id, tenantId: financeBills.tenantId, updatedBy: financeBills.updatedBy, billNo: financeBills.billNo,
  status: financeBills.status, stage: financeBills.stage, poNumber: financeBills.poNumber, isSample: financeBills.isSample,
};
const billFields = (r: { billNo: string; status: string; stage: string; poNumber: string | null; isSample: boolean }): SearchableFields | null =>
  r.isSample ? null : {
    title: `Bill ${r.billNo}`, refNumber: r.billNo, status: r.status,
    summary: `Stage: ${r.stage}${r.poNumber ? ` · PO ${r.poNumber}` : ""}`,
  };

const vendorCols = {
  id: financeVendors.id, tenantId: financeVendors.tenantId, updatedBy: financeVendors.updatedBy, name: financeVendors.name,
  category: financeVendors.category, status: financeVendors.status,
};
const vendorFields = (r: { name: string; category: string; status: string }): SearchableFields => ({ title: r.name, status: r.status, summary: r.category });

const voucherCols = {
  id: financeJournals.id, tenantId: financeJournals.tenantId, updatedBy: financeJournals.updatedBy, voucherNo: financeJournals.voucherNo,
  type: financeJournals.type, status: financeJournals.status, postingDate: financeJournals.postingDate,
};
const voucherFields = (r: { voucherNo: string; type: string; status: string; postingDate: unknown }): SearchableFields => ({
  title: `Voucher ${r.voucherNo}`, refNumber: r.voucherNo, status: r.status, summary: `${r.type} · ${String(r.postingDate)}`,
});

export async function syncBill(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: asTx(tx), entityType: "finance.bill", entityId: id, tenantId,
    load: async () => (await tx.select(billCols).from(financeBills)
      .where(tenantId ? and(eq(financeBills.id, id), eq(financeBills.tenantId, tenantId)) : eq(financeBills.id, id)).limit(1))[0],
    toRecord: billFields,
  });
}

export async function syncVendor(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: asTx(tx), entityType: "finance.vendor", entityId: id, tenantId,
    load: async () => (await tx.select(vendorCols).from(financeVendors)
      .where(tenantId ? and(eq(financeVendors.id, id), eq(financeVendors.tenantId, tenantId)) : eq(financeVendors.id, id)).limit(1))[0],
    toRecord: vendorFields,
  });
}

export async function syncVoucher(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: asTx(tx), entityType: "finance.voucher", entityId: id, tenantId,
    load: async () => (await tx.select(voucherCols).from(financeJournals)
      .where(tenantId ? and(eq(financeJournals.id, id), eq(financeJournals.tenantId, tenantId)) : eq(financeJournals.id, id)).limit(1))[0],
    toRecord: voucherFields,
  });
}

/** Backfill sources (keyset on id). `withTenant` must run `fn` in a transaction that carries the tenant GUC (RLS). */
export function backfillEntities(tenantId: string, withTenant: <T>(fn: (tx: Reader) => Promise<T>) => Promise<T>): BackfillEntity[] {
  return [
    {
      entityType: "finance.voucher",
      source: {
        tenantId, idOf: (r: { id: string }) => r.id,
        fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(voucherCols).from(financeJournals)
          .where(and(eq(financeJournals.tenantId, tenantId), after ? gt(financeJournals.id, after) : undefined)).orderBy(asc(financeJournals.id)).limit(size)),
        toRecord: (r: Parameters<typeof voucherFields>[0] & { id: string }) => ({ ...voucherFields(r), entityType: "finance.voucher" as const, entityId: r.id, tenantId }),
      },
    },
    {
      entityType: "finance.bill",
      source: {
        tenantId, idOf: (r: { id: string }) => r.id,
        fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(billCols).from(financeBills)
          .where(and(eq(financeBills.tenantId, tenantId), after ? gt(financeBills.id, after) : undefined)).orderBy(asc(financeBills.id)).limit(size)),
        toRecord: (r: Parameters<typeof billFields>[0] & { id: string }) => {
          const f = billFields(r);
          return f ? { ...f, entityType: "finance.bill" as const, entityId: r.id, tenantId } : null;
        },
      },
    },
    {
      entityType: "finance.vendor",
      source: {
        tenantId, idOf: (r: { id: string }) => r.id,
        fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(vendorCols).from(financeVendors)
          .where(and(eq(financeVendors.tenantId, tenantId), after ? gt(financeVendors.id, after) : undefined)).orderBy(asc(financeVendors.id)).limit(size)),
        toRecord: (r: Parameters<typeof vendorFields>[0] & { id: string }) => ({ ...vendorFields(r), entityType: "finance.vendor" as const, entityId: r.id, tenantId }),
      },
    },
  ];
}
