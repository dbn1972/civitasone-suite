import { eq, and, inArray } from "drizzle-orm";
import { db, scopedRead } from "../../shared/db.js";
import { billingUsageEvents, billingUsageAggregates } from "./schema.js";
import { periodMonthFromDate } from "./domain.js";
import { billingInvoices } from "../invoices/schema.js";

export type Writer = Pick<typeof db, "insert" | "update" | "select">;

export async function insertEvent(tx: Writer, tenantId: string, metricKey: string, quantity: bigint, actorId: string): Promise<void> {
  await tx.insert(billingUsageEvents).values({
    tenantId, metricKey, quantity, createdBy: actorId, updatedBy: actorId,
  });
}

export async function upsertAggregate(tx: Writer, tenantId: string, metricKey: string, periodMonth: string, quantity: bigint, actorId: string): Promise<void> {
  const existing = await tx.select().from(billingUsageAggregates)
    .where(and(eq(billingUsageAggregates.tenantId, tenantId), eq(billingUsageAggregates.metricKey, metricKey), eq(billingUsageAggregates.periodMonth, periodMonth))).limit(1);
  if (existing[0]) {
    await tx.update(billingUsageAggregates).set({
      totalQuantity: existing[0].totalQuantity + quantity, updatedBy: actorId, updatedAt: new Date(),
    }).where(eq(billingUsageAggregates.id, existing[0].id));
  } else {
    await tx.insert(billingUsageAggregates).values({
      tenantId, metricKey, periodMonth, totalQuantity: quantity, createdBy: actorId, updatedBy: actorId,
    });
  }
}

export async function getMonthlySummary(tenantId: string, month?: string) {
  const periodMonth = month ?? periodMonthFromDate(new Date());
  const rows = await scopedRead((tx) => tx.select().from(billingUsageAggregates)
    .where(and(eq(billingUsageAggregates.tenantId, tenantId), eq(billingUsageAggregates.periodMonth, periodMonth))));
  return { tenantId, periodMonth, metrics: rows.map((r) => ({ metricKey: r.metricKey, total: r.totalQuantity.toString() })) };
}

/** Usage totals and the period's invoice for each period, for ONE tenant (RLS + explicit WHERE). */
export async function meteringForPeriods(tenantId: string, periods: string[]) {
  return scopedRead(async (tx) => {
    const usage = await tx.select().from(billingUsageAggregates)
      .where(and(eq(billingUsageAggregates.tenantId, tenantId), inArray(billingUsageAggregates.periodMonth, periods)));
    const invoices = await tx.select({
      periodMonth: billingInvoices.periodMonth, status: billingInvoices.status, totalMinor: billingInvoices.totalMinor,
      currency: billingInvoices.currency, createdAt: billingInvoices.createdAt,
    }).from(billingInvoices)
      .where(and(eq(billingInvoices.tenantId, tenantId), inArray(billingInvoices.periodMonth, periods)));
    return { usage, invoices };
  });
}
