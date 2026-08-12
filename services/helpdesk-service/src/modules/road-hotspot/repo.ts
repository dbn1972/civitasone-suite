/**
 * Road Hotspot (BRD 5.14 ROAD-004) — repository (data access).
 *
 * Reads wrap in db.transaction() so createTenantDb's wrapWithTenantGuc injects
 * app.tenant_id from AsyncLocalStorage before the query.
 */
import { and, desc, eq, sql } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  roadHotspots,
  roadHotspotLinks,
  type HotspotRow,
  type HotspotInsert,
  type HotspotLinkRow,
  type HotspotLinkInsert,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select" | "delete">;

// ── Hotspots ──────────────────────────────────────────────────────────────────

export async function insertHotspot(tx: Writer, row: HotspotInsert): Promise<HotspotRow> {
  const res = await (tx as typeof db).insert(roadHotspots).values(row).returning();
  return res[0]!;
}

export async function findHotspot(id: string, tenantId: string): Promise<HotspotRow | null> {
  const rows = await db.transaction((tx) =>
    tx
      .select()
      .from(roadHotspots)
      .where(and(eq(roadHotspots.id, id), eq(roadHotspots.tenantId, tenantId)))
      .limit(1),
  );
  return rows[0] ?? null;
}

export async function listHotspots(
  tenantId: string,
  opts: {
    status?: string | undefined;
    category?: string | undefined;
    limit: number;
    offset: number;
  },
): Promise<HotspotRow[]> {
  return db.transaction((tx) => {
    const conds = [eq(roadHotspots.tenantId, tenantId)];
    if (opts.status) conds.push(eq(roadHotspots.status, opts.status));
    if (opts.category) conds.push(eq(roadHotspots.category, opts.category));
    return tx
      .select()
      .from(roadHotspots)
      .where(and(...conds))
      .orderBy(desc(roadHotspots.riskScore))
      .limit(opts.limit)
      .offset(opts.offset);
  });
}

export async function updateHotspot(
  tx: Writer,
  id: string,
  tenantId: string,
  patch: Partial<HotspotInsert>,
): Promise<HotspotRow | null> {
  const res = await (tx as typeof db)
    .update(roadHotspots)
    .set({ ...patch, updatedAt: new Date(), version: sql`${roadHotspots.version} + 1` })
    .where(and(eq(roadHotspots.id, id), eq(roadHotspots.tenantId, tenantId)))
    .returning();
  return res[0] ?? null;
}

// ── Hotspot links ─────────────────────────────────────────────────────────────

export async function insertLink(tx: Writer, row: HotspotLinkInsert): Promise<HotspotLinkRow> {
  const res = await (tx as typeof db).insert(roadHotspotLinks).values(row).returning();
  return res[0]!;
}

export async function listLinks(
  tenantId: string,
  hotspotId: string,
): Promise<HotspotLinkRow[]> {
  return db.transaction((tx) =>
    tx
      .select()
      .from(roadHotspotLinks)
      .where(and(eq(roadHotspotLinks.tenantId, tenantId), eq(roadHotspotLinks.hotspotId, hotspotId)))
      .orderBy(desc(roadHotspotLinks.linkedAt)),
  );
}
