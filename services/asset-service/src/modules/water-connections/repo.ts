import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  assetWaterApplications, assetWaterConnections,
  type WaterApplicationInsert, type WaterApplicationRow,
  type WaterConnectionInsert, type WaterConnectionRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── applications ─────────────────────────────────────────────────────────

export async function insertApplication(tx: Writer, row: WaterApplicationInsert): Promise<void> {
  await tx.insert(assetWaterApplications).values(row);
}

export async function findApplicationById(id: string, tenantId: string): Promise<WaterApplicationRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetWaterApplications)
      .where(and(eq(assetWaterApplications.id, id), eq(assetWaterApplications.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function updateApplicationStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetWaterApplications)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetWaterApplications.id, id), eq(assetWaterApplications.tenantId, tenantId)));
}

export async function listApplications(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetWaterApplications)
    .where(eq(assetWaterApplications.tenantId, tenantId))
    .orderBy(desc(assetWaterApplications.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

// ── connections ──────────────────────────────────────────────────────────

export async function insertConnection(tx: Writer, row: WaterConnectionInsert): Promise<void> {
  await tx.insert(assetWaterConnections).values(row);
}

export async function findConnectionById(id: string, tenantId: string): Promise<WaterConnectionRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetWaterConnections)
      .where(and(eq(assetWaterConnections.id, id), eq(assetWaterConnections.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function updateConnectionStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetWaterConnections)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetWaterConnections.id, id), eq(assetWaterConnections.tenantId, tenantId)));
}

export async function listConnections(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetWaterConnections)
    .where(eq(assetWaterConnections.tenantId, tenantId))
    .orderBy(desc(assetWaterConnections.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}
