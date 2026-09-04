/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (citizen-facing
 * status updates) via the shared @civitasone/events contract.
 *
 * Adapted from shop-service's/trade-service's src/shared/cross-events.ts
 * (Wave 3, PRs #1021/#1022) for parking-service. Wave 3: wired into
 * bookings/consumer.ts (fee challan at recordExit, once the actual parking
 * fee is known — see that file for why NOT at createBooking) and
 * enforcement/consumer.ts (fine challan at issueViolation; status
 * notifications at issueViolation/payViolation/contestViolation) — see those
 * files for call sites.
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
import { zMoneyMinorStringNonNeg } from "@civitasone/schemas";
import { enqueue } from "./outbox.js";
import type { ScopedTx } from "./db.js";
import { SERVICE } from "../topics.js";

export type CrossEventCtx = {
  tenantId: string;
  actorId: string;
  correlationId: string;
};

/**
 * Defensive ceiling on amountMinor. Unlike shop/trade's licensing fees, this
 * service's two fee sources are bounded by domain constants already:
 * enforcement/domain.ts's calculateFineMinor tops out at Rs 2,000 (obstruction),
 * and bookings/consumer.ts's recordExit derives its fee from
 * calculateParkingFee(durationMinutes, facility.tariffPerHourMinor) — an
 * admin-configured hourly tariff times elapsed real time, which is NOT bounded
 * by a same-day cap in this domain, so an abandoned/never-exited booking left
 * open for weeks (or a corrupted tariff) could otherwise produce a runaway
 * amount. Rs 5,00,000 is comfortably above any plausible legitimate parking
 * fee while still catching a corrupted or unbounded value before it reaches
 * finance-service — same "no fake success" reasoning as shop-service's
 * MAX_FEE_CHALLAN_AMOUNT_MINOR.
 */
export const MAX_FEE_CHALLAN_AMOUNT_MINOR = 5_00_000_00n; // Rs 5,00,000 in paise

/** Enqueue finance.challan.create when a parking fee or fine is assessed (amount > 0). */
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
  if (opts.amountMinor > MAX_FEE_CHALLAN_AMOUNT_MINOR) {
    throw new RangeError(
      `emitMunicipalFeeChallan: amountMinor ${opts.amountMinor} exceeds the defensive ceiling ` +
        `(${MAX_FEE_CHALLAN_AMOUNT_MINOR}); refusing to enqueue finance.challan.create for sourceRef=${opts.sourceRef}`,
    );
  }
  // Round-trip through the same hardened money-bounds codec facilities/routes.ts
  // uses for tariff/pass fields (PR #1005's zMoneyMinorStringNonNeg) — amountMinor
  // here is always server-computed (calculateParkingFee / calculateFineMinor),
  // never raw citizen input, but re-validating it as a well-formed non-negative
  // base-10 minor-unit string before it crosses the outbox boundary catches a
  // negative or malformed value from a future caller instead of silently
  // emitting a bad challan. Throws (uncaught) inside this transaction if it
  // somehow fails, same fail-loudly stance as the ceiling check above.
  zMoneyMinorStringNonNeg.parse(opts.amountMinor.toString());

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
