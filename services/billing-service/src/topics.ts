export const COMMANDS = {
  planCreate:           "billing.plan.create",
  subscriptionCreate:   "billing.subscription.create",
  subscriptionActivate: "billing.subscription.activate",
  subscriptionCancel:   "billing.subscription.cancel",
  usageRecord:          "billing.usage.record",
  invoiceGenerate:      "billing.invoice.generate",
  invoiceCreate:        "billing.invoice.create",
  invoiceRequestIssue:  "billing.invoice.request_issue",
  invoiceIssue:         "billing.invoice.issue",
  invoiceRequestCancel: "billing.invoice.request_cancel",
  invoiceApprovalDecide:"billing.invoice.approval_decide",
  invoiceCancel:        "billing.invoice.cancel",
  invoicePay:           "billing.invoice.pay",
  paymentRecord:        "billing.payment.record",
  checkoutCreate:       "billing.checkout.create",
  checkoutVerify:       "billing.checkout.verify",
  webhookRazorpay:      "billing.webhook.razorpay",
  dunningRetry:         "billing.dunning.retry",
  einvoiceGenerate:     "billing.einvoice.generate",
  einvoiceCancel:       "billing.einvoice.cancel",
  revenueLedgerCreate:  "billing.revenue.ledger_create",
  revenueAccrualProcess:"billing.revenue.accrual_process",
} as const;

export const EVENTS = {
  subscriptionExpired: "billing.subscription.expired",
  /** Subscription updated (plan change, usage, payment status) — consumed by ml-service for churn scoring. */
  subscriptionUpdated: "billing.subscription.updated",
  invoiceIssued:       "billing.invoice.issued",
  invoiceCancelled:    "billing.invoice.cancelled",
  invoicePaid:         "billing.invoice.paid",
  paymentReceived:     "billing.payment.received",
  checkoutCompleted:   "billing.checkout.completed",
  checkoutFailed:      "billing.checkout.failed",
  dunningExhausted:    "billing.dunning.exhausted",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "billing";
