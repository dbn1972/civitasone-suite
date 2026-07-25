import { and, eq, sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import {
  procurementVendorPerformanceEvents, procurementVendorScorecards, procurementVendorShowCause,
  type PerfEventInsert, type ScorecardRow, type ScorecardInsert,
  type ShowCauseRow, type ShowCauseInsert,
} from "./scorecard-schema.js";
import type { EventTally } from "./scorecard-domain.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertPerfEvent(tx: Writer, row: PerfEventInsert): Promise<void> {
  await tx.insert(procurementVendorPerformanceEvents).values(row);
}

/** Tally performance-event counts for a vendor (all-time) inside a tx. */
export async function tallyEventsTx(tx: Writer, vendorId: string, tenantId: string): Promise<EventTally> {
  const rows = await (tx as typeof db)
    .select({ eventType: procurementVendorPerformanceEvents.eventType, n: sql<number>`COUNT(*)` })
    .from(procurementVendorPerformanceEvents)
    .where(and(
      eq(procurementVendorPerformanceEvents.vendorId, vendorId),
      eq(procurementVendorPerformanceEvents.tenantId, tenantId),
    ))
    .groupBy(procurementVendorPerformanceEvents.eventType);
  const t: EventTally = { grnAccepted: 0, grnRejected: 0, deliveryLate: 0, deliveryOnTime: 0, slaBreach: 0 };
  for (const r of rows) {
    const n = Number(r.n);
    if (r.eventType === "grn_accepted") t.grnAccepted = n;
    else if (r.eventType === "grn_rejected") t.grnRejected = n;
    else if (r.eventType === "delivery_late") t.deliveryLate = n;
    else if (r.eventType === "delivery_on_time") t.deliveryOnTime = n;
    else if (r.eventType === "sla_breach") t.slaBreach = n;
  }
  return t;
}

export async function upsertScorecardTx(tx: Writer, row: ScorecardInsert): Promise<void> {
  await tx.insert(procurementVendorScorecards).values(row)
    .onConflictDoUpdate({
      target: [procurementVendorScorecards.tenantId, procurementVendorScorecards.vendorId, procurementVendorScorecards.period],
      set: {
        totalOrders: row.totalOrders ?? 0, onTimeDeliveries: row.onTimeDeliveries ?? 0,
        lateDeliveries: row.lateDeliveries ?? 0, qualityRejections: row.qualityRejections ?? 0,
        slaBreaches: row.slaBreaches ?? 0, deliveryScore: row.deliveryScore ?? 0,
        qualityScore: row.qualityScore ?? 0, slaScore: row.slaScore ?? 0,
        overallRating: row.overallRating ?? 0, ratingBand: row.ratingBand ?? "unrated",
        computedAt: new Date(), updatedAt: new Date(),
        version: sql`${procurementVendorScorecards.version} + 1`,
      },
    });
}

export async function findScorecard(vendorId: string, tenantId: string, period = "all"): Promise<ScorecardRow | null> {
  const rows = await db.transaction((tx) => tx.select().from(procurementVendorScorecards)
    .where(and(
      eq(procurementVendorScorecards.vendorId, vendorId),
      eq(procurementVendorScorecards.tenantId, tenantId),
      eq(procurementVendorScorecards.period, period),
    )).limit(1));
  return rows[0] ?? null;
}

// ── Show-cause ───────────────────────────────────────────────────
export async function insertShowCause(tx: Writer, row: ShowCauseInsert): Promise<void> {
  await tx.insert(procurementVendorShowCause).values(row);
}

export async function updateShowCause(tx: Writer, id: string, patch: Partial<ShowCauseInsert>): Promise<void> {
  await tx.update(procurementVendorShowCause).set({ ...patch, updatedAt: new Date() }).where(eq(procurementVendorShowCause.id, id));
}

export async function findShowCauseByIdTx(tx: Writer, id: string, tenantId: string): Promise<ShowCauseRow | null> {
  const rows = await (tx as typeof db).select().from(procurementVendorShowCause)
    .where(and(eq(procurementVendorShowCause.id, id), eq(procurementVendorShowCause.tenantId, tenantId))).limit(1);
  return rows[0] ?? null;
}

export async function findShowCauseById(id: string, tenantId: string): Promise<ShowCauseRow | null> {
  return db.transaction((tx) => findShowCauseByIdTx(tx, id, tenantId));
}

export async function listShowCauseByVendor(vendorId: string, tenantId: string): Promise<ShowCauseRow[]> {
  return db.transaction((tx) => tx.select().from(procurementVendorShowCause)
    .where(and(eq(procurementVendorShowCause.vendorId, vendorId), eq(procurementVendorShowCause.tenantId, tenantId))));
}
