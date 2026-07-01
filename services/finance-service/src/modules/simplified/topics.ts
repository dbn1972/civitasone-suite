/** Command + event topics for the simplified (MSME) accounting module. */

export const SIMPLIFIED_COMMANDS = {
  recordIncome:          "finance.simplified.record_income",
  recordExpense:         "finance.simplified.record_expense",
  recordPaymentReceived: "finance.simplified.record_payment_received",
  recordPaymentMade:     "finance.simplified.record_payment_made",
  seedChart:             "finance.simplified.seed_chart",
} as const;

export const SIMPLIFIED_EVENTS = {
  incomeRecorded:   "finance.simplified.income_recorded",
  expenseRecorded:  "finance.simplified.expense_recorded",
  paymentReceived:  "finance.simplified.payment_received",
  paymentMade:      "finance.simplified.payment_made",
  chartSeeded:      "finance.simplified.chart_seeded",
} as const;
