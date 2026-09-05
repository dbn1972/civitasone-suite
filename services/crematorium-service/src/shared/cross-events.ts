/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (citizen
 * status updates) via the shared @civitasone/events contract.
 *
 * Ported from shop-service's/sewerage-service's shared/cross-events.ts
 * (Wave 3, PR #1021/#1029) — this file is a near-drop-in for all 17
 * municipal services; only the SERVICE import and the doc comment below
 * differ.
 *
 * Wave 3: wired into bookings/consumer.ts's requestBooking (fee challan +
 * application-submitted notification), confirmBooking/completeBooking/
 * cancelBooking (status-changed notification for each citizen-meaningful
 * transition). facilities/consumer.ts and records/consumer.ts are
 * deliberately NOT wired: facility create/update is an internal ULB-admin
 * operation with no citizen recipient, and record-of-service is an
 * internal completion log tied to a booking that was already notified via
 * bookingCompleted — wiring a second notification there would be a
 * duplicate, not a new citizen-meaningful event. See those consumer files
 * for call sites.
 *
 * Fee-amount safety (re-derived directly from this service's own source,
 * not copied from another service's rationale — see bookings/domain.ts):
 * calculateFeeMinor(serviceType) takes ONLY `serviceType`, a value
 * constrained by bookings/routes.ts's request schema to the closed
 * three-member enum ["cremation", "burial", "electric_cremation"], and
 * returns one of three fixed bigint constants (Rs 500 / Rs 300 / Rs 1500
 * in paise). Unlike shop-service (fee is a bounded FORMULA over
 * client-supplied employee-count/area, hence its MAX_FEE_CHALLAN_AMOUNT_MINOR
 * ceiling) or sewerage-service (fee is an admin-gated, wholly
 * client-supplied amount with no formula at all, hence its ADMIN_ROLES
 * route gate), this service's client input can NEVER influence the
 * amount beyond selecting one of three fixed tiers — there is no numeric
 * amount field anywhere in requestBody/confirmBody (bookings/routes.ts).
 * Neither a defensive ceiling nor a role gate applies here: there is no
 * client-supplied quantity to bound or gate in the first place. The only
 * guard that belongs in this file is the zero/negative no-op below
 * (mirrors the shared template's own contract) — do not add one modeled
 * on another service without re-checking this service's own domain.ts,
 * since (as this exact confusion showed while wiring this file) the
 * correct treatment differs service-by-service and must not be copied.
 */
import { randomUUID } from "node:crypto";
import {
  FINANCE_CHALLAN_CREATE,
  NOTIFICATION_SEND,
  MUNICIPAL_EVENT_TYPES,
  buildMunicipalFeeChallanPayload,
  buildMunicipalStatusNotification,
  municipalDecisionNotificationEventType,
} from "@civitasone/events";
import { enqueue } from "./outbox.js";
import type { ScopedTx } from "./db.js";
import { SERVICE } from "../topics.js";

export type CrossEventCtx = {
  tenantId: string;
  actorId: string;
  correlationId: string;
};

/** Enqueue finance.challan.create when a crematorium booking fee is assessed (fee > 0). */
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
