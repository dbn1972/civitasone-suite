import { randomUUID } from "node:crypto";
import { pino } from "pino";
import type { Queue } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { cache } from "../../shared/infra.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import { allocateDocNo } from "../../shared/numbering.js";
import * as repo from "./repo.js";
import { assertRfqTransition, assertDistinctMakerChecker, computeResponseTotalMinor } from "./domain.js";

const log = pino({ name: "procurement.rfq.consumer" });
const AUDIT_TOPIC = "audit.event.record";

export function registerRfqConsumers(queue: Queue): void {
  queue.subscribe(COMMANDS.rfqCreate, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; title: string; description?: string; indentRef?: string;
      closingDate: string; vendorIds: string[];
      items?: Array<{ itemName: string; quantity: number; unit: string }>;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // Gapless server-generated number (#12) — ignore any client-supplied rfqNo.
      const rfqNo = await allocateDocNo(tx, p.tenantId, "rfq");
      await repo.insertRfq(tx, {
        id: p.id, tenantId: p.tenantId, rfqNo, title: p.title,
        description: p.description ?? null, indentRef: p.indentRef ?? null,
        vendorsInvited: p.vendorIds.length, responsesReceived: 0,
        closingDate: p.closingDate, status: "issued",
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      const items = p.items ?? [];
      if (items.length > 0) {
        await repo.insertRfqItems(tx, items.map((i) => ({
          id: randomUUID(), rfqId: p.id, tenantId: p.tenantId,
          itemName: i.itemName, quantity: i.quantity, unit: i.unit,
          createdBy: msg.actorId, updatedBy: msg.actorId,
        })));
      }
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "procurement", action: "create", resourceType: "rfq", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rfq", p.id));
  });

  /**
   * DOM-011: this topic (procurement.rfq.respond) has been published by
   * rfq/commands.ts's respondToRfq() -- and exposed via POST
   * /v1/procurement/rfqs/:id/respond -- since before this fix, but NOTHING in
   * this repo ever subscribed to it (confirmed by repo-wide grep). Every
   * vendor response was queued and then silently dropped: nothing was ever
   * persisted, responsesReceived stayed 0, and rfq/queries.ts's
   * getRfqDetail() hardcoded `responses: []`. This handler is what makes a
   * response actually land somewhere, which is the prerequisite for "award"
   * to mean anything at all.
   */
  queue.subscribe(COMMANDS.rfqRespond, async (msg) => {
    const p = msg.payload as {
      id: string; tenantId: string; rfqId: string; vendorId: string;
      items: Array<{ itemId?: string; itemName?: string; unitPrice: number; leadTimeDays?: number; notes?: string }>;
      validUntil?: string; termsAccepted?: boolean; remarks?: string;
    };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;

      const rfq = await repo.findRfqByIdTx(tx, p.rfqId, p.tenantId);
      // Defense-in-depth: rfq/routes.ts's /respond handler already rejects a
      // missing RFQ or a non-'issued' status synchronously with 404/409
      // before this is ever published. Re-checking here (rather than
      // trusting that earlier check) covers the race where the RFQ closes in
      // the window between that check and this consumer picking the message
      // up -- silently dropping a genuinely-late response here, rather than
      // throwing, mirrors this codebase's own established handling of the
      // identical race elsewhere (see po/consumer.ts's poSubmitApproval: `if
      // (!po || po.tenantId !== p.tenantId) return;`).
      if (!rfq) { log.warn({ rfqId: p.rfqId }, "rfq.respond: RFQ not found, dropping"); return; }
      if (rfq.status !== "issued") {
        log.warn({ rfqId: p.rfqId, status: rfq.status }, "rfq.respond: RFQ not open for responses, dropping");
        return;
      }

      const rfqItems = await repo.findRfqItemsByRfqTx(tx, p.rfqId, p.tenantId);
      const qtyById = new Map(rfqItems.map((i) => [i.id, i.quantity]));
      const totalAmountMinor = computeResponseTotalMinor(p.items, qtyById);

      // A second response from the same vendor is a revised quote (upsert),
      // not an error -- see repo.upsertResponse's doc. Only a genuinely NEW
      // vendor response increments responsesReceived.
      const existing = await repo.findResponseByRfqAndVendorTx(tx, p.rfqId, p.vendorId, p.tenantId);
      await repo.upsertResponse(tx, {
        id: existing?.id ?? p.id, tenantId: p.tenantId, rfqId: p.rfqId, vendorId: p.vendorId,
        items: p.items, totalAmountMinor,
        validUntil: p.validUntil ?? null, termsAccepted: p.termsAccepted ?? false, remarks: p.remarks ?? null,
        createdBy: msg.actorId, updatedBy: msg.actorId,
      });
      if (!existing) {
        await repo.updateRfqVersioned(tx, p.rfqId, rfq.version, { responsesReceived: rfq.responsesReceived + 1 });
      }

      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          service: "procurement", action: existing ? "respond_revise" : "respond",
          resourceType: "rfq_response", resourceId: existing?.id ?? p.id, outcome: "success",
        },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rfq", p.rfqId));
  });

  /**
   * DOM-011: close an issued RFQ -- no more responses accepted, eligible to
   * move to 'awarded' next. rfq/commands.ts's closeRfq() already validated
   * the transition synchronously before publishing; re-validated here under
   * the transaction lock as defense-in-depth (route check and consumer write
   * are not atomic).
   */
  queue.subscribe(COMMANDS.rfqClose, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rfq = await repo.findRfqByIdTx(tx, p.id, p.tenantId);
      if (!rfq) throw new Error(`RFQ ${p.id} not found`);
      assertRfqTransition(rfq.status, "closed");
      await repo.updateRfqVersioned(tx, p.id, rfq.version, {
        status: "closed", closedAt: new Date(), updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.rfqClosed, eventType: EVENTS.rfqClosed,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { rfqId: p.id, rfqNo: rfq.rfqNo },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "procurement", action: "close", resourceType: "rfq", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rfq", p.id));
  });

  /**
   * DOM-011: award a closed RFQ to one of its submitted responses -- the
   * winning response becomes 'awarded', every other still-'submitted'
   * response on the same RFQ becomes 'rejected'. Mirrors
   * tender/consumer.ts's COMMANDS.tenderAward handler's shape (fetch, assert
   * transition, assert SoD, mark winner, mark the rest).
   */
  queue.subscribe(COMMANDS.rfqAward, async (msg) => {
    const p = msg.payload as { id: string; tenantId: string; responseId: string };
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      const rfq = await repo.findRfqByIdTx(tx, p.id, p.tenantId);
      if (!rfq) throw new Error(`RFQ ${p.id} not found`);
      assertRfqTransition(rfq.status, "awarded");
      // Defense-in-depth: rfq/commands.ts's awardRfq() already rejected
      // self-award synchronously with 403 before publishing.
      assertDistinctMakerChecker(rfq.createdBy, msg.actorId);

      const response = await repo.findResponseByIdTx(tx, p.responseId, p.tenantId);
      if (!response || response.rfqId !== p.id) {
        throw new Error(`response ${p.responseId} not found on RFQ ${p.id}`);
      }
      if (response.status !== "submitted") {
        throw new Error(`response ${p.responseId} is not awardable (status '${response.status}')`);
      }

      await repo.updateResponseVersioned(tx, response.id, response.version, {
        status: "awarded", updatedBy: msg.actorId,
      });
      const siblings = await repo.findResponsesByRfqTx(tx, p.id, p.tenantId);
      for (const sibling of siblings) {
        if (sibling.id === response.id || sibling.status !== "submitted") continue;
        await repo.updateResponseVersioned(tx, sibling.id, sibling.version, {
          status: "rejected", updatedBy: msg.actorId,
        });
      }

      await repo.updateRfqVersioned(tx, p.id, rfq.version, {
        status: "awarded", awardedAt: new Date(), awardedResponseId: response.id, updatedBy: msg.actorId,
      });

      await enqueue(tx, {
        topic: EVENTS.rfqAwarded, eventType: EVENTS.rfqAwarded,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: {
          rfqId: p.id, rfqNo: rfq.rfqNo, responseId: response.id,
          vendorId: response.vendorId, totalAmountMinor: String(response.totalAmountMinor),
        },
      });
      await enqueue(tx, {
        topic: AUDIT_TOPIC, eventType: AUDIT_TOPIC,
        tenantId: msg.tenantId, actorId: msg.actorId, correlationId: msg.correlationId,
        payload: { service: "procurement", action: "award", resourceType: "rfq", resourceId: p.id, outcome: "success" },
      });
    });
    await cache.invalidate(cache.makeKey(msg.tenantId, "rfq", p.id));
  });
}
