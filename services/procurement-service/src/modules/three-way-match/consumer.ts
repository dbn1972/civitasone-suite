import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS } from "../../topics.js";
import * as repo from "./repo.js";
import * as poRepo from "../po/repo.js";
import * as grnRepo from "../grn/repo.js";

const log = pino({ name: "procurement.three-way-match.consumer" });
const AUDIT_TOPIC = "audit.event.record";

function diff(a: bigint, b: bigint): bigint {
  return a > b ? a - b : b - a;
}

export function registerThreeWayMatchConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.threeWayMatchRun, async (msg) => {
    const p = msg.payload as {
      id: string;
      tenantId: string;
      poId: string;
      grnId: string;
      invoiceId?: string;
      invoiceAmountMinor?: number;
    };

    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const po = await poRepo.findPoById(p.poId, p.tenantId);
      if (!po) throw new Error(`PO ${p.poId} not found`);
      const grn = await grnRepo.findGrnById(p.grnId);
      if (!grn || grn.tenantId !== p.tenantId) throw new Error(`GRN ${p.grnId} not found`);

      const grnPoId = grn.poRef.replace(/^procurement_po:/, "");
      if (grnPoId !== p.poId) throw new Error("GRN does not belong to the supplied PO");

      const poItems = await poRepo.findPoItemsByPoId(p.poId, p.tenantId);
      const poItemMap = new Map(poItems.map((pi) => [pi.id, pi]));
      const grnItems = await grnRepo.findGrnItemsByGrnId(p.grnId);

      const poAmountMinor = BigInt(po.totalMinor);
      let grnAmountMinor = 0n;
      for (const gi of grnItems) {
        const poItem = poItemMap.get(gi.poItemRef);
        if (poItem) grnAmountMinor += BigInt(poItem.unitPriceMinor) * BigInt(gi.acceptedQty);
      }

      const invoiceAmountMinor = p.invoiceId !== undefined ? BigInt(p.invoiceAmountMinor ?? 0) : 0n;
      let maxDiff = diff(poAmountMinor, grnAmountMinor);
      if (p.invoiceId !== undefined) {
        const invDiff = diff(poAmountMinor, invoiceAmountMinor);
        if (invDiff > maxDiff) maxDiff = invDiff;
      }
      const variancePct = poAmountMinor > 0n ? Number((maxDiff * 10000n) / poAmountMinor) / 100 : 0;
      const matchStatus = variancePct <= 5 ? "matched" : "mismatch";

      await repo.upsertDerivedMatch(tx, {
        tenantId: p.tenantId,
        poId: p.poId,
        grnId: p.grnId,
        poAmountMinor,
        grnAmountMinor,
        matchStatus,
        invoiceId: p.invoiceId ?? null,
        invoiceAmountMinor,
      });

      await enqueue(tx, {
        topic: "procurement.three_way_match.completed",
        eventType: "procurement.three_way_match.completed",
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { id: p.id, poId: p.poId, grnId: p.grnId, matchStatus, variancePct },
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
