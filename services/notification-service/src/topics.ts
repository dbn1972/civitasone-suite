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
  // Scheduling
  scheduleNotification:   "notification.schedule.create",
  cancelSchedule:         "notification.schedule.cancel",
  // Digest
  createDigestRule:       "notification.digest_rule.create",
  updateDigestRule:       "notification.digest_rule.update",
  flushDigest:            "notification.digest.flush",
  // Webhook
  createWebhookEndpoint:  "notification.webhook.create",
  updateWebhookEndpoint:  "notification.webhook.update",
  // Analytics
  recordOpen:             "notification.analytics.open",
  recordClick:            "notification.analytics.click",
  // DND
  setDndWindow:           "notification.dnd.set",
  updateDndWindow:        "notification.dnd.update",
  // I18N
  createLocaleVariant:    "notification.i18n.create",
  updateLocaleVariant:    "notification.i18n.update",
  // Segments
  createSegment:          "notification.segment.create",
  updateSegment:          "notification.segment.update",
  resolveSegment:         "notification.segment.resolve",
  // Approval
  submitTemplate:         "notification.template.submit",
  approveTemplate:        "notification.template.approve",
  rejectTemplate:         "notification.template.reject",
  publishTemplate:        "notification.template.publish",
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
  // Scheduling
  scheduled:              "notification.scheduled",
  scheduleCancelled:      "notification.schedule.cancelled",
  // Digest
  digestFlushed:          "notification.digest.flushed",
  // Webhook
  webhookEndpointCreated: "notification.webhook.created",
  // Analytics
  openTracked:            "notification.analytics.open_tracked",
  clickTracked:           "notification.analytics.click_tracked",
  // DND
  dndWindowSet:           "notification.dnd.window_set",
  dndHeld:                "notification.dnd.held",
  dndReleased:            "notification.dnd.released",
  // I18N
  localeVariantCreated:   "notification.i18n.variant_created",
  localeVariantStale:     "notification.i18n.variant_stale",
  // Segments
  segmentCreated:         "notification.segment.created",
  segmentResolved:        "notification.segment.resolved",
  // Approval
  templateSubmitted:      "notification.template.submitted",
  templateApproved:       "notification.template.approved",
  templateRejected:       "notification.template.rejected",
  templatePublished:      "notification.template.published",
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
  contractExpiryAlert:      "contract.expiry.alert",
  /** Admin change/release management publishes release-notes broadcasts (LOOP 2). */
  notificationBroadcastSend: "notification.broadcast.send",
  /** ML prediction events — high-risk notifications */
  mlBreachRiskHigh:         "ml.prediction.breach_risk_high",
  mlTaskHighRisk:           "ml.prediction.task_high_risk",
  mlChurnRiskHigh:          "ml.prediction.churn_risk_high",
  mlAnomalyDetected:        "ml.prediction.anomaly_detected",
  /** Visitor security/safety events — alert the tenant security control room */
  visitorSecurityIncidentCreated: "visitor.security_incident.created",
  visitorScanBlacklistMatch:      "visitor.scan.blacklist_match",
  visitorTailgatingDetected:      "visitor.tailgating.detected",
  visitorAntiPassbackViolation:   "visitor.anti_passback.violation",
  visitorEmergencyUnlockTriggered: "visitor.emergency.unlock.triggered",
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
