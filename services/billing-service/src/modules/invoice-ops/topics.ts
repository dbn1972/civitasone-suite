/** Topic names owned by the invoice-ops module (offline payments, billing settings, reminders). */
export const OPS_COMMANDS = {
  offlineRequest: "billing.offline_payment.request",
  offlineDecide: "billing.offline_payment.decide",
  makerCheckerSet: "billing.settings.maker_checker",
  makerCheckerDecide: "billing.settings.maker_checker_decide",
  reminderDays: "billing.settings.reminder_days",
  reminderSend: "billing.invoice.reminder_send",
} as const;
