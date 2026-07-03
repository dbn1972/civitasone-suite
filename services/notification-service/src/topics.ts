export const COMMANDS = {
  createTemplate:   "notification.template.create",
  updateTemplate:   "notification.template.update",
  setPrefs:         "notification.prefs.set",
  updatePrefs:      "notification.prefs.update",
  sendNotification: "notification.send",
  createChannel:    "notification.channel.create",
  createAlertRule:  "notification.alert_rule.create",
  enableAlertRule:  "notification.alert_rule.enable",
  disableAlertRule: "notification.alert_rule.disable",
  createCampaign:   "notification.campaign.create",
  sendCampaign:     "notification.campaign.send",
  cancelCampaign:   "notification.campaign.cancel",
} as const;

export const EVENTS = {
  templateCreated:       "notification.template.created",
  templateUpdated:       "notification.template.updated",
  delivered:             "notification.delivered",
  failed:                "notification.failed",
  permanentlyFailed:     "notification.delivery.permanently_failed",
  prefSet:               "notification.prefs.changed",
  channelCreated:        "notification.channel.created",
  alertRuleCreated:      "notification.alert_rule.created",
  campaignCreated:       "notification.campaign.created",
} as const;

/** Events consumed from other services — triggers user notifications. */
export const CONSUMED_EVENTS = {
  hrmsLeaveApproved:        "hrms.leave.approved",
  hrmsLeaveApplied:         "hrms.leave.applied",
  financeSanctionApproved:  "finance.sanction.approved",
  financePaymentMade:       "finance.payment.made",
  financeBillPassed:        "finance.bill.passed",
  procurementGrnAccepted:   "procurement.grn.accepted",
  helpdeskTicketCreated:    "helpdesk.ticket.created",
  helpdeskTicketEscalated:  "helpdesk.ticket.escalated",
  citizenRequestCreated:    "citizen.request.created",
  auditParaIssued:          "audit.para.issued",
} as const;

export const SERVICE = "notification";
export const RESOURCE = {
  template:  "template",
  delivery:  "delivery",
  prefs:     "prefs",
  channel:   "channel",
  alertRule: "alert_rule",
  campaign:  "campaign",
};
