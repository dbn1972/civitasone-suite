import { eq, and, desc } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import {
  assetWaterMeterReadings, assetWaterBills, assetWaterServiceRequests,
  type WaterMeterReadingInsert, type WaterMeterReadingRow,
  type WaterBillInsert, type WaterBillRow,
  type WaterServiceRequestInsert, type WaterServiceRequestRow,
} from "./schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

// ── meter readings ───────────────────────────────────────────────────────

export async function insertReading(tx: Writer, row: WaterMeterReadingInsert): Promise<void> {
  await tx.insert(assetWaterMeterReadings).values(row);
}

export async function findReadingById(id: string, tenantId: string): Promise<WaterMeterReadingRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetWaterMeterReadings)
      .where(and(eq(assetWaterMeterReadings.id, id), eq(assetWaterMeterReadings.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function listReadings(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetWaterMeterReadings)
    .where(eq(assetWaterMeterReadings.tenantId, tenantId))
    .orderBy(desc(assetWaterMeterReadings.readingDate))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

// ── bills ────────────────────────────────────────────────────────────────

export async function insertBill(tx: Writer, row: WaterBillInsert): Promise<void> {
  await tx.insert(assetWaterBills).values(row);
}

export async function findBillById(id: string, tenantId: string): Promise<WaterBillRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetWaterBills)
      .where(and(eq(assetWaterBills.id, id), eq(assetWaterBills.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function listBills(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetWaterBills)
    .where(eq(assetWaterBills.tenantId, tenantId))
    .orderBy(desc(assetWaterBills.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

export async function updateBillStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetWaterBills)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetWaterBills.id, id), eq(assetWaterBills.tenantId, tenantId)));
}

// ── service requests ─────────────────────────────────────────────────────

export async function insertServiceRequest(tx: Writer, row: WaterServiceRequestInsert): Promise<void> {
  await tx.insert(assetWaterServiceRequests).values(row);
}

export async function findServiceRequestById(id: string, tenantId: string): Promise<WaterServiceRequestRow | null> {
  const rows = await scopedRead((tx) =>
    tx.select().from(assetWaterServiceRequests)
      .where(and(eq(assetWaterServiceRequests.id, id), eq(assetWaterServiceRequests.tenantId, tenantId)))
      .limit(1));
  return rows[0] ?? null;
}

export async function listServiceRequests(tenantId: string, opts?: { limit?: number; offset?: number }) {
  return scopedRead((tx) => tx.select().from(assetWaterServiceRequests)
    .where(eq(assetWaterServiceRequests.tenantId, tenantId))
    .orderBy(desc(assetWaterServiceRequests.createdAt))
    .limit(opts?.limit ?? 50)
    .offset(opts?.offset ?? 0));
}

export async function updateServiceRequestStatus(
  tx: Writer, id: string, tenantId: string, status: string, extra?: Record<string, unknown>,
): Promise<void> {
  await (tx as typeof db).update(assetWaterServiceRequests)
    .set({ status, updatedAt: new Date(), ...extra })
    .where(and(eq(assetWaterServiceRequests.id, id), eq(assetWaterServiceRequests.tenantId, tenantId)));
}
