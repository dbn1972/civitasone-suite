import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { sql } from "drizzle-orm";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as poRepo from "../po/repo.js";
import * as grnRepo from "../grn/repo.js";
import { evaluateMatch, resolveToleranceConfig, type ToleranceConfig, type ToleranceConfigRow } from "./domain.js";

const log = pino({ name: "procurement.three-way-match.consumer" });
const AUDIT_TOPIC = "audit.event.record";

/** DOM-011: sentinel tenant_id for the platform-default tolerance config row (see migration 0033). */
const PLATFORM_TENANT_ID = "00000000-0000-0000-0000-000000000000";

/**
 * DOM-011: effective, per-tenant three-way-match tolerance for this run.
 * Mirrors payroll-service's resolveRunStatutoryConfig() (payroll/consumer.ts)
 * exactly, right down to the placement: this reads through the CALLER's
 * already-open transaction (`tx`) and never opens its own, so it shares the
 * outer transaction's pool connection -- see the TX-001 comment on the *Tx
 * reads below for why a nested, independently-opened transaction is a
 * pool-exhaustion/deadlock risk under load. RLS's additive
 * platform_default_read_policy (migration 0033) makes the sentinel
 * platform-default row visible alongside the tenant's own override row in
 * one query; resolution itself is the pure resolveToleranceConfig() in
 * domain.ts.
 */
export async function resolveThreeWayMatchToleranceConfig(tx: typeof db, tenantId: string): Promise<ToleranceConfig> {
  const rows = (await tx.execute(sql`
    SELECT tenant_id, qty_tolerance_pct, price_tolerance_pct, total_tolerance_pct
    FROM procurement.three_way_match_config
    WHERE tenant_id IN (${tenantId}::uuid, ${PLATFORM_TENANT_ID}::uuid)
  `)) as unknown as Array<{
    tenant_id: string;
    qty_tolerance_pct: number | string;
    price_tolerance_pct: number | string;
    total_tolerance_pct: number | string;
  }>;
  const mapped: ToleranceConfigRow[] = rows.map((r) => ({
    tenantId: r.tenant_id === PLATFORM_TENANT_ID ? null : r.tenant_id,
    qtyTolerancePct: Number(r.qty_tolerance_pct),
    priceTolerancePct: Number(r.price_tolerance_pct),
    totalTolerancePct: Number(r.total_tolerance_pct),
  }));
  return resolveToleranceConfig(mapped, tenantId);
}

export function registerThreeWayMatchConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.threeWayMatchRun, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      poId: string;
      grnId: string;
      invoiceId?: string;
      // DOM-011 follow-up (filed separately in the gap report): this number is
      // entirely client-asserted -- there is no independent invoice-ingestion
      // or vendor e-invoicing source in this system to verify it against. Out
      // of scope for DOM-011 itself (which is about the TOLERANCE check being
      // blended/hardcoded, not about invoice provenance), but worth flagging
      // at the exact point it is trusted rather than silently passing it on.
      invoiceAmountMinor?: number;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      // TX-001 (procurement) — all four reads below used to be bare
      // (non-tx) calls that each opened their OWN nested db.transaction()
      // from inside this already-open one: under concurrent load, one
      // logical unit of work could hold two pool connections at once,
      // exhausting the pool and deadlocking it. Routed through the *Tx
      // siblings so every read shares this transaction's connection.
      const po = await poRepo.findPoByIdTx(tx, p.poId, p.tenantId);
      if (!po) throw new Error(`PO ${p.poId} not found`);
      const grn = await grnRepo.findGrnByIdTx(tx, p.grnId);
      if (!grn || grn.tenantId !== p.tenantId) throw new Error(`GRN ${p.grnId} not found`);

      const grnPoId = grn.poRef.replace(/^procurement_po:/, "");
      if (grnPoId !== p.poId) throw new Error("GRN does not belong to the supplied PO");

      const poItems = await poRepo.findPoItemsByPoIdTx(tx, p.poId, p.tenantId);
      const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));
      const grnItems = await grnRepo.findGrnItemsByGrnTx(tx, p.grnId);

      const poAmountMinor = BigInt(po.totalMinor);
      let grnAmountMinor = 0n;
      for (const gi of grnItems) {
        const poItem = poItemMap.get(gi.poItemRef);
        if (poItem) grnAmountMinor += BigInt(poItem.unitPriceMinor) * BigInt(gi.acceptedQty);
      }

      const invoicePresent = p.invoiceId !== undefined;
      const invoiceAmountMinor = invoicePresent ? BigInt(p.invoiceAmountMinor ?? 0) : 0n;

      // DOM-011: per-tenant configurable tolerance (qty/price/total, each
      // independently), resolved through this SAME open transaction (see
      // resolveThreeWayMatchToleranceConfig above), then applied by the pure
      // evaluateMatch() in domain.ts instead of the old inline blended-total
      // `<= 5` check.
      const tolerance = await resolveThreeWayMatchToleranceConfig(tx as unknown as typeof db, p.tenantId);
      const result = evaluateMatch(
        {
          poAmountMinor,
          grnAmountMinor,
          grnQtyLines: grnItems.map((gi) => ({ orderedQty: gi.orderedQty, acceptedQty: gi.acceptedQty })),
          invoicePresent,
          invoiceAmountMinor,
        },
        tolerance,
      );

      await repo.upsertDerivedMatch(tx, {
        id: p.id,
        tenantId: p.tenantId,
        poId: p.poId,
        grnId: p.grnId,
        poAmountMinor,
        grnAmountMinor,
        matchStatus: result.matchStatus,
        invoiceId: p.invoiceId ?? null,
        invoiceAmountMinor,
        variancePct: result.totalVariancePct,
        autoMatched: true,
        qtyVariancePct: result.qtyVariancePct,
        priceVariancePct: invoicePresent ? result.priceVariancePct : null,
        qtyTolerancePct: tolerance.qtyTolerancePct,
        priceTolerancePct: tolerance.priceTolerancePct,
        totalTolerancePct: tolerance.totalTolerancePct,
      });

      await enqueue(tx, {
        topic: "procurement.three_way_match.completed",
        eventType: "procurement.three_way_match.completed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          id: p.id,
          poId: p.poId,
          grnId: p.grnId,
          matchStatus: result.matchStatus,
          variancePct: result.totalVariancePct,
          qtyVariancePct: result.qtyVariancePct,
          priceVariancePct: result.priceVariancePct,
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC,
        eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: {
          service: "procurement",
          action: "three_way_match",
          resourceType: "three_way_match",
          resourceId: p.id,
          outcome: "success",
        },
      });
    });

    await cache.invalidate(`procurement:${msg.tenantId}:three_way_match:*`);
    log.info({ id: msg.messageId }, "Processed three_way_match.run");
  });
}
