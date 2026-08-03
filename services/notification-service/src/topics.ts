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
  // CH-06: Delivery → CRM Timeline
  deliveryToCrm:          "notification.delivery.to_crm",
  // CH-07: Inbound Messages
  inboundReceived:        "notification.inbox.inbound_received",
  // CH-09: Convert Conversation to Ticket
  convertToTicket:        "notification.inbox.convert_to_ticket",
  // INT-04: Inbox-Ticket Correlation
  correlateInbox:         "notification.inbox.correlate",
  // CR-MKT-04: Email deliverability — sending domains + DKIM/SPF/DMARC health
  registerSendingDomain:  "notification.email.sending_domain.register",
  recordDomainAuthCheck:  "notification.email.domain_auth_check.record",
  // CR-MKT-05: A/B experiments + engagement heatmaps
  createExperiment:       "notification.experiment.create",
  recordExperimentEvent:  "notification.experiment.event.record",
  concludeExperiment:     "notification.experiment.conclude",
  // CR-MKT-06: Keyword auto-responses on inbound SMS/WhatsApp
  createKeywordRule:      "notification.inbox.keyword_rule.create",
  updateKeywordRule:      "notification.inbox.keyword_rule.update",
  // MT-006: Web push + in-app messaging
  registerPushSubscription: "notification.push.subscription.register",
  revokePushSubscription:   "notification.push.subscription.revoke",
  createInAppMessage:       "notification.in_app.message.create",
  markInAppRead:            "notification.in_app.message.read",
  // INT-12: Bounce classification + suppression
  recordBounce:           "notification.bounce.record",
  releaseSuppression:     "notification.suppression.release",
  // F.5: Human handoff — AI pause/resume protocol
  transitionHandoff:      "notification.inbox.handoff.transition",
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
  /**
   * R1 consent gate refused an outbound send before any adapter ran.
   * Payload: `{ deliveryId: string; reason: "recipient_suppressed"|"marketing_consent_denied"
   *            |"marketing_consent_unknown"|"channel_consent_denied"; channel: string;
   *            recipientId: string | null }`
   * Fires: once per refused send. The recipient address is NEVER in the payload.
   */
  consentBlocked:         "notification.consent.blocked",
  /**
   * P1-6 — a recipient withdrew consent through an INBOUND message (an SMS /
   * WhatsApp "STOP" that matched a keyword rule carrying an opt-out action).
   * Payload: `{ ruleId: string; channel: string; reason: "unsubscribe";
   *            source: "inbound"; recipientHash: string }`
   * Fires: once per inbound message that recorded a suppression. The recipient
   * address is NEVER in the payload — `recipientHash` is the non-reversible
   * blind index, which is what downstream consumers can correlate on.
   */
  consentOptedOut:        "notification.consent.opted_out",
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
  // CH-06: Delivery → CRM Timeline
  deliveryForwardedToCrm: "notification.delivery.forwarded_to_crm",
  // CH-07: Inbound Messages
  inboundLeadCreated:     "notification.inbox.lead_created",
  // CH-09: Convert Conversation to Ticket
  convertedToTicket:      "notification.inbox.converted_to_ticket",
  // INT-04: Inbox-Ticket Correlation
  inboxCorrelated:        "notification.inbox.correlated",

  /* ---- CR-MKT-04: email deliverability ---------------------------------- */
  /**
   * A sending domain has been registered for a tenant.
   * Payload: `{ sendingDomainId: string; domain: string; dkimSelector: string }`
   * Fires: after the register command's row is committed. The domain starts at
   * health `unknown` — no DNS has been checked yet.
   */
  sendingDomainRegistered: "notification.email.sending_domain.registered",
  /**
   * A DKIM/SPF/DMARC check result has been recorded against a sending domain.
   * Payload: `{ checkId: string; sendingDomainId: string; health: "healthy"|"degraded"|"failing"|"unknown";
   *            dkim: "pass"|"fail"|"missing"; spf: same; dmarc: same }`
   * Fires: every time a check result is stored, whether submitted by the
   * scheduled checker or by an operator.
   */
  domainAuthCheckRecorded: "notification.email.domain_auth_check.recorded",
  /**
   * A sending domain's authentication is failing — mail from it is at risk of
   * rejection. Payload: `{ sendingDomainId: string; domain: string; dkim, spf, dmarc }`
   * Fires: only when a recorded check rolls up to health `failing`. Intended for
   * alerting.
   */
  domainAuthFailing:       "notification.email.domain_auth.failing",

  /* ---- CR-MKT-05: A/B experiments --------------------------------------- */
  /**
   * An A/B experiment and its variants have been created.
   * Payload: `{ experimentId: string; name: string; variantIds: string[] }`
   * Fires: after the experiment + variant rows commit.
   */
  experimentCreated:       "notification.experiment.created",
  /**
   * An engagement event (open or click) has been attributed to a variant.
   * Payload: `{ experimentId: string; variantId: string; eventType: "open"|"click";
   *            linkPosition: number | null }`
   * Fires: once per recorded event. `linkPosition` drives the click heatmap.
   */
  experimentEventRecorded: "notification.experiment.event.recorded",
  /**
   * An experiment has been concluded and its winner (if any) frozen.
   * Payload: `{ experimentId: string; decided: boolean; winnerVariantId: string | null }`
   * Fires: on conclude. `decided: false` means the "clear leader" rule found no
   * winner — it is NOT a statement of statistical significance either way.
   */
  experimentConcluded:     "notification.experiment.concluded",

  /* ---- CR-MKT-06: keyword auto-responses -------------------------------- */
  /**
   * A keyword routing rule has been created.
   * Payload: `{ ruleId: string; matchType: "exact"|"prefix"|"contains"; channel: string | null }`
   * Fires: after the rule row commits.
   */
  keywordRuleCreated:      "notification.inbox.keyword_rule.created",
  /**
   * An inbound message matched a keyword rule and the rule was acted on.
   * Payload: `{ ruleId: string; channel: string;
   *            outcome: "reply"|"action"|"reply_and_action"; action: string | null }`
   * Fires: once per inbound message that matched. No PII in the payload — the
   * sender is deliberately omitted.
   */
  keywordAutoResponded:    "notification.inbox.keyword_auto_responded",

  /* ---- MT-006: web push + in-app messaging ------------------------------ */
  /**
   * A device/browser has been registered for push.
   * Payload: `{ subscriptionId: string; userId: string; platform: "web"|"android"|"ios" }`
   * Fires: on register (including re-registration of an existing token).
   * The device token is NEVER in the payload — it is a bearer credential.
   */
  pushSubscriptionRegistered: "notification.push.subscription.registered",
  /**
   * A push subscription has been revoked (user signed out, token rotated).
   * Payload: `{ subscriptionId: string }`
   * Fires: on revoke. The row is retained, disabled, for audit.
   */
  pushSubscriptionRevoked:    "notification.push.subscription.revoked",
  /**
   * An in-app message has been placed in a user's inbox.
   * Payload: `{ messageId: string; userId: string; severity: string }`
   * Fires: after the message row commits.
   */
  inAppMessageCreated:        "notification.in_app.message.created",
  /**
   * A user has read an in-app message.
   * Payload: `{ messageId: string; userId: string }`
   * Fires: on the first read only — a repeat read is a no-op and emits nothing.
   */
  inAppMessageRead:           "notification.in_app.message.read_marked",

  /* ---- INT-12: bounces + suppression ----------------------------------- */
  /**
   * A bounce has been classified and stored.
   * Payload: `{ bounceEventId: string; deliveryId: string | null; channel: string;
   *            classification: "hard"|"soft"|"unknown"; suppressed: boolean }`
   * Fires: once per recorded bounce. The recipient address is NOT in the payload.
   */
  bounceRecorded:          "notification.bounce.recorded",
  /**
   * A recipient has been added to the tenant's suppression list.
   * Payload: `{ bounceEventId: string; recipientHash: string; channel: string;
   *            reason: "hard_bounce"|"soft_bounce_threshold"; softBounceCount: number }`
   * Fires: on a hard bounce, or when soft bounces reach the configured
   * threshold. `recipientHash` is an irreversible blind index, not an address.
   */
  recipientSuppressed:     "notification.suppression.added",
  /**
   * A suppression entry has been released by an operator.
   * Payload: `{ suppressionId: string }`
   * Fires: on release. Sends to that recipient resume immediately.
   */
  suppressionReleased:     "notification.suppression.released",

  /* ---- F.5: human handoff ---------------------------------------------- */
  /**
   * An AI-handled conversation changed handoff state.
   * Payload: `{ conversationId: string; fromState: string; toState: string;
   *            action: "pause"|"assign_human"|"resume_ai"|"close";
   *            aiPaused: boolean; agentId: string | null }`
   * Fires: on every accepted transition. `aiPaused` is the flag the AI agent
   * reads to decide whether it may reply.
   */
  handoffStateChanged:     "notification.inbox.handoff.state_changed",
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
