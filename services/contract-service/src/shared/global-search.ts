/**
 * Contracts -> cross-module search. Indexed: contract number, title, status, and the expiry date. NOT indexed: value,
 * vendor, PO reference, SLA terms or any clause text. Flag off for the tenant => returns before any query.
 */
import { and, asc, eq, gt } from "drizzle-orm";
import { syncGlobalRecord, type BackfillEntity, type DrizzleTx, type SearchableFields } from "@civitasone/search";
import { contractContracts } from "../modules/contracts/schema.js";
import type { db } from "./db.js";

type Reader = Pick<typeof db, "select">;

const cols = {
  id: contractContracts.id, tenantId: contractContracts.tenantId, updatedBy: contractContracts.updatedBy,
  contractNo: contractContracts.contractNo, title: contractContracts.title, status: contractContracts.status, expiry: contractContracts.expiry,
};
const fields = (r: { contractNo: string; title: string; status: string; expiry: unknown }): SearchableFields => ({
  title: r.title, refNumber: r.contractNo, status: r.status, summary: `Expires ${String(r.expiry)}`,
});

export async function syncContract(tx: Reader, id: string, tenantId?: string): Promise<void> {
  await syncGlobalRecord({
    tx: tx as unknown as DrizzleTx, entityType: "contracts.contract", entityId: id, tenantId,
    load: async () => (await tx.select(cols).from(contractContracts)
      .where(tenantId ? and(eq(contractContracts.id, id), eq(contractContracts.tenantId, tenantId)) : eq(contractContracts.id, id)).limit(1))[0],
    toRecord: fields,
  });
}

export function backfillEntities(tenantId: string, withTenant: <T>(fn: (tx: Reader) => Promise<T>) => Promise<T>): BackfillEntity[] {
  return [{
    entityType: "contracts.contract",
    source: {
      tenantId, idOf: (r: { id: string }) => r.id,
      fetchPage: (after: string | null, size: number) => withTenant((tx) => tx.select(cols).from(contractContracts)
        .where(and(eq(contractContracts.tenantId, tenantId), after ? gt(contractContracts.id, after) : undefined)).orderBy(asc(contractContracts.id)).limit(size)),
      toRecord: (r: Parameters<typeof fields>[0] & { id: string }) => ({ ...fields(r), entityType: "contracts.contract" as const, entityId: r.id, tenantId }),
    },
  }];
}
