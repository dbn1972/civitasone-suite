/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (citizen
 * status updates) via the shared @civitasone/events contract.
 *
 * Ported from building-service's/animal-service's shared/cross-events.ts
 * (Wave 3 template) — this file is a near-drop-in for all 17 municipal
 * services; only the SERVICE import and this doc comment differ.
 *
 * Wave 3 wiring for THIS service (parks-service): none of its four modules
 * (complaints, tree_requests, inspections, assets) has an amount/fee column
 * anywhere in schema.ts — parks-service has no fee concept at all, unlike
 * e.g. building's application fee or animal's registration fee. So
 * emitMunicipalFeeChallan below is exported for interface parity with the
 * other 16 services (same reasoning as building-service's own file, which
 * defines it unconditionally) but has NO call site in this service — see
 * modules/complaints/consumer.ts and modules/tree_requests/consumer.ts for
 * where emitMunicipalNotification IS wired, and their comments for why
 * inspections/consumer.ts and assets/consumer.ts are deliberately NOT wired
 * (pure back-office workflows: inspectorId/createdBy are staff, not a
 * citizen contact, and neither row carries a citizen-facing party at all).
 */
import { randomUUID } from "node:crypto";
import {
  FINANCE_CHALLAN_CREATE,
  NOTIFICATION_SEND,
  buildMunicipalFeeChallanPayload,
  buildMunicipalStatusNotification,
  municipalDecisionNotificationEventType,
  MUNICIPAL_EVENT_TYPES,
} from "@civitasone/events";
import { enqueue } from "./outbox.js";
import type { ScopedTx } from "./db.js";
import { SERVICE } from "../topics.js";

export type CrossEventCtx = {
  tenantId: string;
  actorId: string;
  correlationId: string;
};

/**
 * Enqueue finance.challan.create when a fee is assessed (fee > 0).
 * Not called anywhere in this service today — see file header — kept for
 * interface parity with the other 16 municipal services sharing this
 * template, and so a future fee-bearing parks module (season passes,
 * facility-hire charges, etc.) has a ready-made, already-reviewed helper
 * instead of a bespoke one.
 */
export async function emitMunicipalFeeChallan(
  tx: ScopedTx,
  ctx: CrossEventCtx,
  opts: {
    sourceRef: string;
    depositor: string;
    amountMinor: bigint;
    currency?: string;
    receiptHeadCode?: string;
  },
): Promise<void> {
  if (opts.amountMinor <= 0n) return;
  const payloadInput: Parameters<typeof buildMunicipalFeeChallanPayload>[0] = {
    id: randomUUID(),
    tenantId: ctx.tenantId,
    depositor: opts.depositor,
    amountMinor: opts.amountMinor,
    sourceService: SERVICE,
    sourceRef: opts.sourceRef,
  };
  if (opts.currency) payloadInput.currency = opts.currency;
  if (opts.receiptHeadCode) payloadInput.receiptHeadCode = opts.receiptHeadCode;
  await enqueue(tx, {
    topic: FINANCE_CHALLAN_CREATE,
    eventType: FINANCE_CHALLAN_CREATE,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: buildMunicipalFeeChallanPayload(payloadInput),
  });
}

/** Enqueue notification.send for citizen-facing status changes. */
export async function emitMunicipalNotification(
  tx: ScopedTx,
  ctx: CrossEventCtx,
  opts: {
    eventType: string;
    recipient: string;
    recipientId?: string;
    variables?: Record<string, string>;
  },
): Promise<void> {
  await enqueue(tx, {
    topic: NOTIFICATION_SEND,
    eventType: NOTIFICATION_SEND,
    tenantId: ctx.tenantId,
    actorId: ctx.actorId,
    correlationId: ctx.correlationId,
    payload: buildMunicipalStatusNotification(opts),
  });
}

export { municipalDecisionNotificationEventType, MUNICIPAL_EVENT_TYPES };
