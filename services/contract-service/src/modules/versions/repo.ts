import { eq, and, sql, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { contractVersions, redlines, type ContractVersionRow, type RedlineRow, type ContractVersionInsert, type RedlineInsert } from "./schema.js";

/** Execute a read within a tenant-scoped transaction (sets app.tenant_id GUC for RLS). */
async function tenantRead<T>(tenantId: string, fn: (tx: typeof db) => Promise<T>): Promise<T> {
  return scopedRead(fn as (tx: any) => Promise<T>);
}

export async function countVersionsByContract(contractId: string, tenantId: string): Promise<number> {
  return tenantRead(tenantId, async (tx) => {
    const [result] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contractVersions)
      .where(and(eq(contractVersions.contractId, contractId), eq(contractVersions.tenantId, tenantId)));
    return result?.count ?? 0;
  });
}

export async function getLatestVersion(contractId: string, tenantId: string): Promise<ContractVersionRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contractVersions)
      .where(and(eq(contractVersions.contractId, contractId), eq(contractVersions.tenantId, tenantId)))
      .orderBy(desc(contractVersions.versionNumber))
      .limit(1);
    return row;
  });
}

export async function getVersionByNumber(contractId: string, tenantId: string, versionNumber: number): Promise<ContractVersionRow | undefined> {
  return tenantRead(tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(contractVersions)
      .where(
        and(
          eq(contractVersions.contractId, contractId),
          eq(contractVersions.tenantId, tenantId),
          eq(contractVersions.versionNumber, versionNumber),
        ),
      )
      .limit(1);
    return row;
  });
}

export async function listVersions(
  contractId: string,
  tenantId: string,
  opts: { limit: number; offset: number },
): Promise<{ data: ContractVersionRow[]; total: number }> {
  return tenantRead(tenantId, async (tx) => {
    const where = and(eq(contractVersions.contractId, contractId), eq(contractVersions.tenantId, tenantId));

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(contractVersions)
      .where(where);

    const data = await tx
      .select()
      .from(contractVersions)
      .where(where)
      .orderBy(contractVersions.versionNumber)
      .limit(opts.limit)
      .offset(opts.offset);

    return { data, total: countResult?.count ?? 0 };
  });
}

export async function insertVersion(version: ContractVersionInsert): Promise<ContractVersionRow> {
  const [row] = await scopedRead((tx) => tx.insert(contractVersions).values(version).returning());
  return row!;
}

export async function insertRedlines(records: RedlineInsert[]): Promise<RedlineRow[]> {
  if (records.length === 0) return [];
  const rows = await scopedRead((tx) => tx.insert(redlines).values(records).returning());
  return rows;
}

export async function getRedlinesByVersion(
  contractId: string,
  tenantId: string,
  versionNumber: number,
): Promise<RedlineRow[]> {
  return tenantRead(tenantId, async (tx) => {
    return tx
      .select()
      .from(redlines)
      .where(
        and(
          eq(redlines.contractId, contractId),
          eq(redlines.tenantId, tenantId),
          eq(redlines.versionNumber, versionNumber),
        ),
      )
      .orderBy(redlines.position);
  });
}
