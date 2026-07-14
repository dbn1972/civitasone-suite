import { NonRetryableError, type CommandEnvelope } from "@civitasone/queue";
import { db } from "../../shared/db.js";
import { enqueue, markProcessed } from "../../shared/outbox.js";
import { COMMANDS, EVENTS } from "../../topics.js";
import * as repo from "./repo.js";
import * as configRepo from "../config-registry/repo.js";
import { DEFAULT_ORDER_TYPES, assertOrderTypeAllowed } from "./domain.js";
import { effectiveAllowed } from "../config-registry/domain.js";

type RecordOrderPayload = {
  id: string;
  caseId: string;
  tenantId: string;
  hearingId?: string;
  orderType: string;
  orderText: string;
  orderDate?: string; // YYYY-MM-DD
};

export function registerOrderConsumers(
  register: <T>(topic: string, handler: (msg: CommandEnvelope<T>) => Promise<void>) => void,
): void {
  // Record (draft) an order (§23).
  //
  // MAKER-CHECKER: this module records the *drafted* order only. The
  // ORDER-ISSUANCE approval flow (approver ≠ maker, DSC signing, pronouncement)
  // belongs to the workflow engine plus a later order-approval step — NOT here.
  // No AI / auto-issuance (§35.5): an order is never issued automatically.
  register<RecordOrderPayload>(COMMANDS.recordOrder, async (msg) => {
    const p = msg.payload;
    await db.transaction(async (tx) => {
      if (!(await markProcessed(tx, msg.messageId))) return;
      // §47 config/metadata: orderType must be in the effective allowed set — the
      // tenant’s configured `order_type` values when any exist (AUTHORITATIVE —
      // REPLACES the defaults), else DEFAULT_ORDER_TYPES.
      const configured = await configRepo.listActiveKeys(tx, p.tenantId, "order_type");
      const allowedTypes = effectiveAllowed(configured, DEFAULT_ORDER_TYPES);
      try {
        assertOrderTypeAllowed(p.orderType, allowedTypes);
      } catch (e) {
        throw new NonRetryableError((e as Error).message);
      }
      await repo.insertOrder(tx, {
        id: p.id,
        tenantId: p.tenantId,
        caseId: p.caseId,
        hearingId: p.hearingId ?? null,
        orderType: p.orderType,
        orderText: p.orderText,
        // signedBy records the officer who drafted/recorded the order. The
        // detached DSC signature is applied later via packages/render as a
        // SEPARATE order-signing step — not at draft time; hence null here.
        signedBy: msg.actorId,
        dscSignature: null,
        orderDate: p.orderDate ?? null,
        createdBy: msg.actorId,
        updatedBy: msg.actorId,
      });
      await enqueue(tx, {
        topic: EVENTS.orderRecorded,
        eventType: EVENTS.orderRecorded,
        tenantId: msg.tenantId,
        actorId: msg.actorId,
        correlationId: msg.correlationId,
        payload: { caseId: p.caseId, orderId: p.id, orderType: p.orderType, orderDate: p.orderDate ?? null },
      });
      await audit(tx, msg, "record", "court_order", p.id);
    });
  });
}

async function audit(
  tx: Parameters<typeof markProcessed>[0],
  msg: { tenantId: string; actorId: string; correlationId: string },
  action: string,
  resourceType: string,
  resourceId: string,
): Promise<void> {
  await enqueue(tx, {
    topic: "audit.event.record",
    eventType: "audit.event.record",
    tenantId: msg.tenantId,
    actorId: msg.actorId,
    correlationId: msg.correlationId,
    payload: { service: "court", action, resourceType, resourceId, outcome: "success" },
  });
}
