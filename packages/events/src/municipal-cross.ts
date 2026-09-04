/**
 * Cross-service outbox payloads for municipal Sec5 licensing services.
 * Emit via transactional outbox — finance.challan.create and notification.send.
 *
 * Ported from origin/ai/feature-municipal-sec5-services (held branch,
 * services/<name>-service/src/shared/cross-events.ts template + this file),
 * with three fixes applied during the port — see inline notes:
 *
 *  1. receiptHeadId was a fabricated placeholder UUID. Fixed: the payload now
 *     carries a stable control-head CODE; finance-service's challanCreate
 *     consumer resolves it to a real head id per tenant (hard-erroring if
 *     absent), the same way it already resolves BANK_CODE / the deposit
 *     liability head. See services/finance-service/src/modules/treasury/consumer.ts
 *     and migrations/0070_municipal_cross_service_challan.sql.
 *  2. amountMinor round-tripped through a JS `number` (`Number(bigint)` here,
 *     `BigInt(p.amountMinor)` on finance's receiving side) — silent precision
 *     loss above Number.MAX_SAFE_INTEGER. Fixed: carried end-to-end as a
 *     base-10 digit string via the canonical @civitasone/schemas money codec
 *     (the same fix class as PR #985 / revenue-service).
 *  3. sourceService/sourceRef were accepted but silently dropped by finance's
 *     consumer — no back-link from the challan row to the originating
 *     municipal application. Fixed: persisted on treasury.finance_challans
 *     (source_service/source_ref columns added in the same migration).
 */
import { minorString } from "@civitasone/schemas/money";
import { buildNotificationPayload, NOTIFICATION_SEND, type NotificationSendPayload } from "./notification.js";

/** finance-service treasury consumer (COMMANDS.challanCreate). */
export const FINANCE_CHALLAN_CREATE = "finance.challan.create" as const;

/** billing-service invoices consumer (COMMANDS.invoiceCreate). */
export const BILLING_INVOICE_CREATE = "billing.invoice.create" as const;

/**
 * Default municipal-fee receipt control-head CODE. finance-service resolves
 * this to a real budget.finance_heads.id per tenant inside the challanCreate
 * consumer (headIdByCode) and hard-errors if the tenant has no head seeded
 * for this code — it is never trusted as a raw id from the producer.
 * Seeded for the platform default tenant in
 * services/finance-service/migrations/0070_municipal_cross_service_challan.sql;
 * a real production tenant needs the same code seeded during its own
 * provisioning, mirroring how 2060/4300 are seeded (see migration 0015).
 */
export const MUNICIPAL_FEE_RECEIPT_HEAD_CODE = "0075" as const;

/** Canonical municipal domain event types emitted by the 17 Sec5 services. */
export const MUNICIPAL_EVENT_TYPES = {
  applicationSubmitted: "municipal.application.submitted",
  feeDue: "municipal.fee.due",
  statusChanged: "municipal.status.changed",
  permitIssued: "municipal.permit.issued",
} as const;

export type MunicipalFeeChallanPayload = {
  id: string;
  tenantId: string;
  /** Placeholder — finance-service allocates the real challan number. */
  challanNo: string;
  /** Control-head code (see MUNICIPAL_FEE_RECEIPT_HEAD_CODE) — resolved to a
   *  real head id inside finance-service's challanCreate consumer. */
  receiptHeadCode: string;
  depositor: string;
  /** Base-10 minor-unit string. Never a JS number — see file header, fix (2). */
  amountMinor: string;
  currency?: string;
  sourceService: string;
  sourceRef: string;
};

export function buildMunicipalFeeChallanPayload(opts: {
  id: string;
  tenantId: string;
  depositor: string;
  amountMinor: bigint | number | string;
  currency?: string;
  sourceService: string;
  sourceRef: string;
  receiptHeadCode?: string;
}): MunicipalFeeChallanPayload {
  return {
    id: opts.id,
    tenantId: opts.tenantId,
    challanNo: "PENDING",
    receiptHeadCode: opts.receiptHeadCode ?? MUNICIPAL_FEE_RECEIPT_HEAD_CODE,
    depositor: opts.depositor,
    amountMinor: minorString(opts.amountMinor),
    currency: opts.currency ?? "INR",
    sourceService: opts.sourceService,
    sourceRef: opts.sourceRef,
  };
}

/** Map municipal approval decisions to a system notification template when available. */
export function municipalDecisionNotificationEventType(
  domainEventType: string,
  decision: string,
): string {
  if (decision === "approved") return "citizen.application.approved";
  return domainEventType;
}

export function buildMunicipalStatusNotification(opts: {
  eventType: string;
  recipient: string;
  recipientId?: string;
  channel?: NotificationSendPayload["channel"];
  variables?: Record<string, string>;
}): NotificationSendPayload {
  return buildNotificationPayload(opts);
}

export { NOTIFICATION_SEND };
