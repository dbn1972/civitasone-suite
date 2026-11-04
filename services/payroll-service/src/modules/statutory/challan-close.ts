/**
 * Review SF3: POST /v1/payroll/statutory/pf/challan/close -- close a wage
 * month's EPF challan: records the A/c 2 minimum top-up for the establishment
 * (tenant) and month exactly once (unique tenant + period) and, when there is
 * a shortfall, sends its journal to finance in the same transaction (outbox).
 * A second close of the same month returns the recorded row and posts nothing.
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import { INTEGRATION } from "../../topics.js";
import { payrollPf, payrollEpfAdminTopups } from "./schema.js";
import { notExcludedSlip } from "./repo.js";
import { adminTopUpMinor, adminTopUpJournal } from "./admin-topup.js";

export interface ChallanCloseResult {
  period: string; memberCount: number; adminAccruedMinor: string; minimumMinor: string;
  topUpMinor: string; journalId: string | null; alreadyClosed: boolean;
}

const shapeRow = (r: typeof payrollEpfAdminTopups.$inferSelect, alreadyClosed: boolean): ChallanCloseResult => ({
  period: r.period, memberCount: r.memberCount, adminAccruedMinor: r.adminAccruedMinor.toString(),
  minimumMinor: r.minimumMinor.toString(), topUpMinor: r.topUpMinor.toString(), journalId: r.journalId ?? null, alreadyClosed,
});

export async function closePfChallan(ctx: RequestContext, period: string): Promise<ChallanCloseResult> {
  const { resolveRunStatutoryConfig } = await import("../payroll/consumer.js");
  return db.transaction(async (tx) => {
    // One close per tenant + month, even under concurrent calls.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`epf-challan-close:${ctx.tenantId}:${period}`}, 0))`);
    const [existing] = await tx.select().from(payrollEpfAdminTopups)
      .where(and(eq(payrollEpfAdminTopups.tenantId, ctx.tenantId), eq(payrollEpfAdminTopups.period, period))).limit(1);
    if (existing) return shapeRow(existing, true);
    const [agg] = await tx.select({
      n: sql<string>`count(*)`,
      admin: sql<string>`coalesce(sum(${payrollPf.epfAdminMinor}), 0)`,
    }).from(payrollPf).where(and(eq(payrollPf.tenantId, ctx.tenantId), eq(payrollPf.period, period), notExcludedSlip(payrollPf.slipId)));
    const memberCount = Number(agg?.n ?? 0);
    if (memberCount === 0) throw new HttpError(404, "NOT_FOUND", `No PF records found for period ${period}`);
    const cfg = await resolveRunStatutoryConfig(tx as never, ctx.tenantId, period);
    const adminAccrued = BigInt(agg?.admin ?? 0);
    const topUp = adminTopUpMinor(adminAccrued, memberCount, cfg.epfAdminMinMinor);
    const journalId = topUp > 0n ? deterministicUuid(`epf-admin-topup:${ctx.tenantId}:${period}`) : null;
    const [row] = await tx.insert(payrollEpfAdminTopups).values({
      tenantId: ctx.tenantId, period, memberCount, adminAccruedMinor: adminAccrued, minimumMinor: cfg.epfAdminMinMinor,
      topUpMinor: topUp, journalId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }).returning();
    if (journalId) {
      await enqueue(tx, {
        topic: INTEGRATION.glPost, eventType: INTEGRATION.glPost,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { ...adminTopUpJournal({ journalId, tenantId: ctx.tenantId, period, topUpMinor: topUp, postingDate: new Date().toISOString().slice(0, 10) }) },
      });
    }
    await enqueue(tx, {
      topic: "audit.event.record", eventType: "audit.event.record",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId ?? randomUUID(),
      payload: {
        service: "payroll", action: "epf_challan_close", resourceType: "statutory_ecr", resourceId: `ECR:${period}`, outcome: "success",
        newValue: { memberCount, adminAccruedMinor: adminAccrued.toString(), minimumMinor: cfg.epfAdminMinMinor.toString(), topUpMinor: topUp.toString(), journalId },
      },
    });
    return shapeRow(row!, false);
  });
}
