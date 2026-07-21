/** saved metrics repo — tenant-scoped named metric definitions. */
import { eq, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { savedMetrics, type SavedMetricRow, type SavedMetricInsert, type SavedMetricView } from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export function toView(r: SavedMetricRow): SavedMetricView {
  return { id: r.id, tenantId: r.tenantId, name: r.name, metricKey: r.metricKey, spec: r.spec, version: r.version };
}

export async function insert(tx: Writer, row: SavedMetricInsert): Promise<void> {
  await tx.insert(savedMetrics).values(row);
}

export async function listByTenant(tenantId: string, limit: number, offset: number): Promise<SavedMetricView[]> {
  const rows = await scopedRead(async (tx) =>
    tx
      .select()
      .from(savedMetrics)
      .where(eq(savedMetrics.tenantId, tenantId))
      .orderBy(desc(savedMetrics.updatedAt))
      .limit(limit)
      .offset(offset),
  );
  return rows.map(toView);
}
