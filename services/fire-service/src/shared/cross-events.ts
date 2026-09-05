/**
 * Cross-service outbox helpers for this municipal Sec5 service — emits
 * finance.challan.create (fee assessed) and notification.send (applicant
 * status updates) via the shared @civitasone/events contract.
 *
 * Ported from origin/ai/feature-municipal-sec5-services with the receiptHeadId
 * fabrication and amountMinor precision bugs fixed at the shared-package
 * level (see packages/events/src/municipal-cross.ts header) — this file is
 * otherwise a near-drop-in for all 17 municipal services, mirroring
 * shop-service's and building-service's src/shared/cross-events.ts.
 *
 * Wave 3: wired into applications/consumer.ts (fee challan at application
 * creation, status notification at submission), inspections/consumer.ts
 * (scheduled/completed status notifications), nocs/consumer.ts
 * (issue/suspend/revoke notifications) and lifecycle/consumer.ts (renewal
 * fee challan at request time, decision notification at decide time) — see
 * those files for call sites.
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
 * Defensive ceiling on amountMinor, mirroring the same fleet-wide convention
 * used by shop-service/building-service's cross-events.ts (Rs 1 crore in
 * paise). This service's own fee calculators (applications/domain.ts's
 * calculateFeeMinor, lifecycle/domain.ts's calculateRenewalFee) are both
 * fixed-schedule and server-computed — never a client-supplied amount — so
 * this is defense-in-depth rather than a normally-reachable path. It is,
 * however, a real backstop: applications/routes.ts's createBody Zod schema
 * bounds builtUpArea only as *a* string (no numeric ceiling) and
 * numberOfFloors only as nonnegative (no upper bound), so a large enough
 * builtUpArea could in principle inflate calculateFeeMinor's area surcharge
 * well past any realistic building. Rather than guess at a "real" building
 * size limit here (a routes.ts-level input-validation fix, out of this
 * pass's scope — see PR description), this ceiling stops an inflated amount
 * at the point it would otherwise cross into finance-service's real GL
 * ledger, exactly like every other municipal service's copy of this
 * function.
 */
export const MAX_FEE_CHALLAN_AMOUNT_MINOR = 100_000_000_00n; // Rs 1,00,00,000 (1 crore) in paise

/** Enqueue finance.challan.create when a licensing/renewal fee is assessed (fee > 0). */
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
