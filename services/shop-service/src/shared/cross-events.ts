/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (applicant
 * status updates) via the shared @civitasone/events contract.
 *
 * Ported from origin/ai/feature-municipal-sec5-services with the receiptHeadId
 * fabrication and amountMinor precision bugs fixed at the shared-package
 * level (see packages/events/src/municipal-cross.ts header) — this file is
 * otherwise a near-drop-in for all 17 municipal services.
 *
 * Wave 3: wired into registrations/consumer.ts (fee challan at application
 * creation, status notification at submission), approvals/consumer.ts
 * (decision notification), permits/consumer.ts (issue/suspend/cancel/restore
 * notifications) and lifecycle/consumer.ts (renewal fee challan + decision
 * notification) — see those files for call sites.
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
 * Defensive ceiling on amountMinor, mirroring registrations/routes.ts's
 * fee-math bounds (PR #1013's MAX_EMPLOYEE_COUNT / MAX_AREA_SQFT): with those
 * input ceilings, the largest fee either of this service's fee calculators
 * (registrations/domain.ts's calculateFeeMinor, lifecycle/domain.ts's
 * calculateRenewalFeeMinor) can actually produce is a few lakh rupees —
 * comfortably under this ceiling. A value that clears it here means an
 * upstream bound was weakened without a matching update in this file; fail
 * loudly instead of silently emitting a fee challan for an unbounded or
 * corrupted amount (the same "no fake success" reasoning applied throughout
 * this service's consumers).
 */
export const MAX_FEE_CHALLAN_AMOUNT_MINOR = 100_000_000_00n; // Rs 1,00,00,000 (1 crore) in paise

/** Enqueue finance.challan.create when a licensing fee is assessed (fee > 0). */
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

/** Enqueue notification.send for applicant-facing status changes. */
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
