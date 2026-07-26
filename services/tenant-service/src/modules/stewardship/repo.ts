/**
 * stewardship repository (CAP-019). All reads run under the tenant GUC
 * (runWithTenant + db.transaction) so FORCED RLS returns the tenant's rows.
 */
import { and, eq } from "drizzle-orm";
import { runWithTenant } from "@civitasone/db";
import { db } from "../../shared/db.js";
import { dataDomains, dataStewards, dataAssets, type DataDomainRow, type DataStewardRow, type DataAssetRow } from "./schema.js";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
function scoped<T>(tenantId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return runWithTenant(tenantId, () => db.transaction(fn)) as Promise<T>;
}

export function listDomains(tenantId: string): Promise<DataDomainRow[]> {
  return scoped(tenantId, (tx) => tx.select().from(dataDomains).where(eq(dataDomains.tenantId, tenantId)).orderBy(dataDomains.name));
}

export function findDomain(tenantId: string, id: string): Promise<DataDomainRow | undefined> {
  return scoped(tenantId, (tx) => findDomainTx(tx, tenantId, id));
}

export async function findDomainTx(tx: Tx, tenantId: string, id: string): Promise<DataDomainRow | undefined> {
  const rows = await tx.select().from(dataDomains).where(and(eq(dataDomains.id, id), eq(dataDomains.tenantId, tenantId))).limit(1);
  return rows[0];
}

export function listStewards(tenantId: string, domainId: string): Promise<DataStewardRow[]> {
  return scoped(tenantId, (tx) => tx.select().from(dataStewards).where(and(eq(dataStewards.tenantId, tenantId), eq(dataStewards.domainId, domainId))).orderBy(dataStewards.role));
}

export function listAssets(tenantId: string, domainId?: string): Promise<DataAssetRow[]> {
  return scoped(tenantId, (tx) => {
    const where = domainId
      ? and(eq(dataAssets.tenantId, tenantId), eq(dataAssets.domainId, domainId))
      : eq(dataAssets.tenantId, tenantId);
    return tx.select().from(dataAssets).where(where).orderBy(dataAssets.name);
  });
}

export async function insertDomain(tx: Tx, data: typeof dataDomains.$inferInsert): Promise<void> {
  await tx.insert(dataDomains).values(data);
}
export async function insertSteward(tx: Tx, data: typeof dataStewards.$inferInsert): Promise<void> {
  await tx.insert(dataStewards).values(data).onConflictDoNothing();
}
export async function insertAsset(tx: Tx, data: typeof dataAssets.$inferInsert): Promise<void> {
  await tx.insert(dataAssets).values(data);
}
