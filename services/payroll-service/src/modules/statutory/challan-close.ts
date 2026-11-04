/**
 * Review SF3 + delta review SF2 (ERP-head decisions 2026-11-05):
 * POST /v1/payroll/statutory/pf/challan/close -- close a wage month's EPF
 * challan and accrue the A/c 2 minimum shortfall for the establishment
 * (tenant).
 *   - Refused (409 RUNS_OPEN) while any run of the period is still draft /
 *     processing / computed: only final runs count.
 *   - Only APPROVED / DISBURSED / PAID runs are summed (failed / cancelled
 *     ignored): the shortfall is max(0, minimum - admin accrued by them).
 *   - Append-only: each close records the approved run set it saw
 *     (run_set_key) and books only the DELTA against what earlier closes of
 *     the month already booked -- a supplementary run approved later is
 *     picked up by a re-close (a negative delta reverses part of an earlier
 *     top-up). Closing the same run set again is idempotent (200, nothing
 *     posted). Each non-zero delta goes to finance as its own journal in the
 *     same transaction (outbox).
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { RequestContext } from "@civitasone/types";
import { db } from "../../shared/db.js";
import { enqueue } from "../../shared/outbox.js";
import { HttpError } from "../../shared/context.js";
import { deterministicUuid } from "../../shared/deterministic-id.js";
import { INTEGRATION } from "../../topics.js";
import { payrollRuns } from "../payroll/schema.js";
import { payrollPf, payrollEpfAdminTopups } from "./schema.js";
import { notExcludedSlip } from "./repo.js";
import { adminTopUpMinor, adminTopUpJournal } from "./admin-topup.js";

const FINAL_RUN_STATUSES = new Set(["approved", "disbursed", "paid"]);
const IGNORED_RUN_STATUSES = new Set(["failed", "cancelled"]);

export interface ChallanCloseResult {
  period: string; memberCount: number; adminAccruedMinor: string; minimumMinor: string;
  /** Full shortfall for the closed run set. */
  targetTopUpMinor: string;
  /** The delta this close booked (negative = a reversal). */
  topUpMinor: string;
  runIds: string[]; journalId: string | null; alreadyClosed: boolean;
}

const shapeRow = (r: typeof payrollEpfAdminTopups.$inferSelect, alreadyClosed: boolean): ChallanCloseResult => ({
  period: r.period, memberCount: r.memberCount, adminAccruedMinor: r.adminAccruedMinor.toString(),
  minimumMinor: r.minimumMinor.toString(), targetTopUpMinor: r.targetTopUpMinor.toString(), topUpMinor: r.topUpMinor.toString(),
  runIds: r.runSetKey ? r.runSetKey.split(",") : [], journalId: r.journalId ?? null, alreadyClosed,
});

export async function closePfChallan(ctx: RequestContext, period: string): Promise<ChallanCloseResult> {
  const { resolveRunStatutoryConfig } = await import("../payroll/consumer.js");
  return db.transaction(async (tx) => {
    // One close at a time per tenant + month.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`epf-challan-close:${ctx.tenantId}:${period}`}, 0))`);
    const runs = await tx.select({ id: payrollRuns.id, runNo: payrollRuns.runNo, status: payrollRuns.status }).from(payrollRuns)
      .where(and(eq(payrollRuns.tenantId, ctx.tenantId), eq(payrollRuns.month, period)));
    const open = runs.filter((r) => !FINAL_RUN_STATUSES.has(r.status) && !IGNORED_RUN_STATUSES.has(r.status));
    if (open.length > 0) {
      throw new HttpError(409, "RUNS_OPEN", `the EPF challan for ${period} cannot be closed while run(s) ${open.map((r) => `${r.runNo} (${r.status})`).join(", ")} are not approved`);
    }
    const finalIds = runs.filter((r) => FINAL_RUN_STATUSES.has(r.status)).map((r) => r.id).sort();
    if (finalIds.length === 0) throw new HttpError(404, "NOT_FOUND", `No approved payroll run for period ${period}`);
    const runSetKey = finalIds.join(",");
    const prior = await tx.select().from(payrollEpfAdminTopups)
      .where(and(eq(payrollEpfAdminTopups.tenantId, ctx.tenantId), eq(payrollEpfAdminTopups.period, period)));
    const same = prior.find((r) => r.runSetKey === runSetKey);
    if (same) return shapeRow(same, true);
    const [agg] = await tx.select({
      n: sql<string>`count(*)`,
      admin: sql<string>`coalesce(sum(${payrollPf.epfAdminMinor}), 0)`,
    }).from(payrollPf).where(and(eq(payrollPf.tenantId, ctx.tenantId), eq(payrollPf.period, period),
      inArray(payrollPf.runId, finalIds), notExcludedSlip(payrollPf.slipId)));
    const memberCount = Number(agg?.n ?? 0);
    if (memberCount === 0) throw new HttpError(404, "NOT_FOUND", `No PF records found for the approved runs of period ${period}`);
    const cfg = await resolveRunStatutoryConfig(tx as never, ctx.tenantId, period);
    const adminAccrued = BigInt(agg?.admin ?? 0);
    const target = adminTopUpMinor(adminAccrued, memberCount, cfg.epfAdminMinMinor);
    const booked = prior.reduce((s, r) => s + r.topUpMinor, 0n);
    const delta = target - booked;
    const journalId = delta !== 0n ? deterministicUuid(`epf-admin-topup:${ctx.tenantId}:${period}:${runSetKey}`) : null;
    const [row] = await tx.insert(payrollEpfAdminTopups).values({
      tenantId: ctx.tenantId, period, memberCount, adminAccruedMinor: adminAccrued, minimumMinor: cfg.epfAdminMinMinor,
      targetTopUpMinor: target, topUpMinor: delta, runSetKey, journalId, createdBy: ctx.actorId, updatedBy: ctx.actorId,
    }).returning();
    if (journalId) {
      await enqueue(tx, {
        topic: INTEGRATION.glPost, eventType: INTEGRATION.glPost,
        tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId,
        payload: { ...adminTopUpJournal({ journalId, tenantId: ctx.tenantId, period, topUpMinor: delta, postingDate: new Date().toISOString().slice(0, 10) }) },
      });
    }
    await enqueue(tx, {
      topic: "audit.event.record", eventType: "audit.event.record",
      tenantId: ctx.tenantId, actorId: ctx.actorId, correlationId: ctx.correlationId ?? randomUUID(),
      payload: {
        service: "payroll", action: "epf_challan_close", resourceType: "statutory_ecr", resourceId: `ECR:${period}`, outcome: "success",
        oldValue: { bookedTopUpMinor: booked.toString() },
        newValue: { memberCount, adminAccruedMinor: adminAccrued.toString(), minimumMinor: cfg.epfAdminMinMinor.toString(), targetTopUpMinor: target.toString(), deltaMinor: delta.toString(), runIds: finalIds, journalId },
      },
    });
    return shapeRow(row!, false);
  });
}
