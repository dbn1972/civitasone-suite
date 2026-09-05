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
 * Wave 3: wired into registration/consumer.ts (fee challan + acknowledgement
 * notification at registerAnimal, renewal notification at
 * renewRegistration, transfer notification at transferRegistration) and
 * complaints/consumer.ts (acknowledgement notification at reportComplaint,
 * status notifications at dispatchTeam/markActionTaken/closeComplaint) —
 * see those files for call sites. assignComplaint is deliberately NOT
 * wired (internal staff-assignment step, no new information for the
 * citizen — same reasoning sewerage applied to its own complaintAssign).
 * operations/consumer.ts's recordOperation is also deliberately NOT wired:
 * it is a field-operations log (capture/sterilize/vaccinate/etc. performed
 * on an animal) with no citizen contact captured anywhere on that row,
 * mirroring sewerage's fieldRecordCreate.
 *
 * Like sewerage-service, this service has no citizen display-name field on
 * animal_complaints (only a `reportedBy` uuid) — so `recipient` for
 * complaint notifications is the record's own human-readable reference
 * number (complaintNumber), the same fallback sewerage/parking used when
 * they had no citizen name to hand. animal_registrations DOES carry
 * ownerName/ownerPhone directly, so registration notifications use the
 * real owner name, matching shop-service's pattern.
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
 * Defensive ceiling on amountMinor. Unlike sewerage-service (which
 * deliberately has NO ceiling because its fees are admin/officer-set via an
 * ADMIN_ROLES-gated route with no tariff schedule to validate against),
 * this service's only fee producer — registration/domain.ts's
 * calculateRegistrationFee — is a fixed, animal-type-keyed lookup table
 * with no user-supplied amount anywhere in its inputs (dog=Rs 500,
 * cat=Rs 300, everything else=Rs 250; see that function). A citizen can
 * only ever influence which of those three fixed values is picked, never
 * the value itself, so this is the safe case from PR #1029's gotcha: no
 * ADMIN_ROLES gate is needed here. This ceiling is a generous multiple of
 * the schedule's real maximum (Rs 500), so it only ever trips if a future
 * change to the schedule (or a corrupted amount) produces something wildly
 * out of line with the fixed-fee model this service actually implements —
 * the same "fail loudly instead of emitting a fee challan for an unbounded
 * or corrupted amount" reasoning as shop-service's MAX_FEE_CHALLAN_AMOUNT_MINOR.
 */
export const MAX_FEE_CHALLAN_AMOUNT_MINOR = 500_000n; // Rs 5,000 in paise (10x the Rs 500 schedule max)

/** Enqueue finance.challan.create when a registration/licensing fee is assessed (fee > 0). */
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
