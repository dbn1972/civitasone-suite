import { eq, and, sql, desc, isNotNull } from "drizzle-orm";
import { scopedRead } from "../../shared/db.js";
import { assetAssets } from "../register/schema.js";

export async function getDashboard(tenantId: string) {
  // scopedRead() so wrapWithTenantGuc injects app.tenant_id before these
  // reads — a bare db.select() runs with no RLS GUC set.
  const [total] = await scopedRead((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(eq(assetAssets.tenantId, tenantId)));

  const [fixedCount] = await scopedRead((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.assetType, "fixed"))));

  const [infraCount] = await scopedRead((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.assetType, "infra"))));

  const [maintenance] = await scopedRead((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), eq(assetAssets.status, "under_maintenance"))));

  const [dueForDisposal] = await scopedRead((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(and(
      eq(assetAssets.tenantId, tenantId),
      eq(assetAssets.status, "active"),
      sql`${assetAssets.bookValue} <= ${assetAssets.salvageValue} + 100`,
    )));

  const [tagged] = await scopedRead((tx) => tx
    .select({ count: sql<number>`count(*)::int` })
    .from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), isNotNull(assetAssets.barcode))));

  const [netBlockRow] = await scopedRead((tx) => tx
    .select({
      netBlock: sql<string>`COALESCE(SUM(book_value), 0)::text`,
    })
    .from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), sql`status NOT IN ('disposed', 'written_off')`)));

  const recentGrn = await scopedRead((tx) => tx.select({
    id: assetAssets.id,
    code: assetAssets.code,
    name: assetAssets.name,
    acquisitionDate: assetAssets.acquisitionDate,
    acquisitionCost: assetAssets.acquisitionCost,
  }).from(assetAssets)
    .where(and(eq(assetAssets.tenantId, tenantId), isNotNull(assetAssets.grnRef)))
    .orderBy(desc(assetAssets.createdAt))
    .limit(8));

  return {
    totalAssets: total?.count ?? 0,
    fixedAssets: fixedCount?.count ?? 0,
    infraAssets: infraCount?.count ?? 0,
    underMaintenance: maintenance?.count ?? 0,
    dueForDisposal: dueForDisposal?.count ?? 0,
    taggedAssets: tagged?.count ?? 0,
    netBlock: Number(netBlockRow?.netBlock ?? "0"),
    recentGrnAssets: recentGrn.map((r) => ({
      id: r.id,
      code: r.code,
      name: r.name,
      acquisitionDate: r.acquisitionDate,
      acquisitionCost: Number(r.acquisitionCost),
    })),
  };
}
