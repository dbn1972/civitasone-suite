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
} as const;

export const EVENTS = {
  subscriptionExpired: "billing.subscription.expired",
  invoiceIssued:       "billing.invoice.issued",
  invoiceCancelled:    "billing.invoice.cancelled",
  invoicePaid:         "billing.invoice.paid",
  paymentReceived:     "billing.payment.received",
} as const;

export const SERVICE = "billing";
