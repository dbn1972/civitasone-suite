/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (citizen
 * status updates) via the shared @civitasone/events contract.
 *
 * Ported from shop-service's/trade-service's shared/cross-events.ts (Wave 3,
 * PR #1021/#1022) — this file is a near-drop-in for all 17 municipal
 * services; only the SERVICE import and the doc comment below differ.
 *
 * Wave 3: wired into connections/consumer.ts (application-submitted
 * notification at connectionApply, status-changed notification at
 * connectionUpdateStatus, connection-activated notification at
 * connectionActivate), billing/consumer.ts (fee challan + fee-due
 * notification at billGenerate, paid notification at billPay),
 * desludging/consumer.ts (booking-submitted notification + fee challan at
 * desludgingBook when a fee was quoted, status notifications at
 * desludgingSchedule/Dispatch/Complete/Cancel) and complaints/consumer.ts
 * (complaint-received notification at complaintCreate, resolved
 * notification at complaintResolve) — see those files for call sites.
 *
 * Unlike shop-service/vendor-service, this service has no citizen
 * display-name field anywhere in its schema (applications/bookings/
 * complaints carry only a `uuid` actor reference, never a name) — so
 * `recipient` below is always the record's own human-readable reference
 * number (applicationNumber/connectionNumber/billNumber/bookingNumber/
 * complaintNumber), the same fallback parking-service used for
 * `booking.vehicleNumber` when it also had no citizen name to hand.
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

/**
 * Unlike shop-service's MAX_FEE_CHALLAN_AMOUNT_MINOR (derived from
 * calculateFeeMinor's own bounded inputs — employee count, area — so a
 * value above it really can only mean a corrupted or unbounded upstream
 * amount), this service deliberately has NO comparable ceiling here.
 * billing/routes.ts and desludging/routes.ts both validate amountMinor/
 * feeMinor with nothing tighter than the shared zMoneyMinorStringNonNeg
 * codec (bounded only by Postgres bigint range), and PR #1014 hardened
 * billing/schema.ts's amountMinor and desludging/schema.ts's feeMinor to
 * real `bigint` columns for exactly this reason — a large admin-entered
 * bill or desludging fee (e.g. a big industrial connection) is legitimate
 * input here, not a sign of corruption, and tests/hardening.integration.
 * test.ts's money-precision regression test deliberately exercises a value
 * at the very top of the bigint range end to end through this exact path.
 * A RangeError thrown from inside billGenerate's/desludgingBook's
 * transaction would abort the underlying bill/booking write too — adding an
 * invented ceiling here would silently break legitimate large bills in
 * production and, as verified while wiring this in, does exactly that to
 * the existing hardening test. The only real guard that belongs here is the
 * zero/negative no-op below (mirrors the shared template's own contract).
 */

/** Enqueue finance.challan.create when a sewerage fee is assessed (fee > 0). */
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
