/**
 * Cross-service outbox payloads for municipal Sec5 licensing services.
 * Emit via transactional outbox — finance.challan.create and notification.send.
 */
import { buildNotificationPayload, NOTIFICATION_SEND, type NotificationSendPayload } from "./notification.js";

/** finance-service treasury consumer (COMMANDS.challanCreate). */
export const FINANCE_CHALLAN_CREATE = "finance.challan.create" as const;

/** billing-service invoices consumer (COMMANDS.invoiceCreate). */
export const BILLING_INVOICE_CREATE = "billing.invoice.create" as const;

export type MunicipalFeeChallanPayload = {
  id: string;
  tenantId: string;
  /** Placeholder — finance-service allocates the real challan number. */
  challanNo: string;
  receiptHeadId: string;
  depositor: string;
  amountMinor: number;
  currency?: string;
  sourceService: string;
  sourceRef: string;
};

/** Default receipt head when tenant env is not configured (dev / tests). */
export const MUNICIPAL_FEE_RECEIPT_HEAD_PLACEHOLDER =
  "00000000-0000-4000-8001-00000000fee1" as const;

export function resolveMunicipalFeeReceiptHeadId(override?: string): string {
  return override ?? process.env.MUNICIPAL_FEE_RECEIPT_HEAD_ID ?? MUNICIPAL_FEE_RECEIPT_HEAD_PLACEHOLDER;
}

export function buildMunicipalFeeChallanPayload(opts: {
  id: string;
  tenantId: string;
  depositor: string;
  amountMinor: bigint | number;
  currency?: string;
  sourceService: string;
  sourceRef: string;
  receiptHeadId?: string;
}): MunicipalFeeChallanPayload {
  const amount =
    typeof opts.amountMinor === "bigint" ? Number(opts.amountMinor) : opts.amountMinor;
  return {
    id: opts.id,
    tenantId: opts.tenantId,
    challanNo: "PENDING",
    receiptHeadId: resolveMunicipalFeeReceiptHeadId(opts.receiptHeadId),
    depositor: opts.depositor,
    amountMinor: amount,
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
