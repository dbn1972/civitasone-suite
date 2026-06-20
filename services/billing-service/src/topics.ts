export const COMMANDS = {
  planCreate:           "billing.plan.create",
  subscriptionCreate:   "billing.subscription.create",
  subscriptionActivate: "billing.subscription.activate",
  subscriptionCancel:   "billing.subscription.cancel",
  usageRecord:          "billing.usage.record",
  invoiceGenerate:      "billing.invoice.generate",
  invoiceIssue:         "billing.invoice.issue",
  invoicePay:           "billing.invoice.pay",
  paymentRecord:        "billing.payment.record",
} as const;

export const EVENTS = {
  subscriptionExpired: "billing.subscription.expired",
  invoiceIssued:       "billing.invoice.issued",
} as const;

export const SERVICE = "billing";
