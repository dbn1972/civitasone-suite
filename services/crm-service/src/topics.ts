/** Topic + event names owned by crm-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createContact: "crm.contact.create",
  updateContact: "crm.contact.update",
  deleteContact: "crm.contact.delete",
  mergeContacts: "crm.contact.merge",
  bulkImportContacts: "crm.contact.bulk_import",
  createDeal: "crm.deal.create",
  updateDealStage: "crm.deal.update_stage",
  updateDeal: "crm.deal.update",
  deleteDeal: "crm.deal.delete",
  createPipeline: "crm.pipeline.create",
  updatePipeline: "crm.pipeline.update",
  deletePipeline: "crm.pipeline.delete",
  createActivity: "crm.activity.create",
  updateActivity: "crm.activity.update",
  createAccount: "crm.account.create",
  recalculateLeadScore: "crm.lead.score_recalculate",
  /** Inbound lead capture from any channel (email, telephony, chatbot, whatsapp, partner_api). */
  inboundCapture: "crm.lead.inbound_capture",
  /** Lead lifecycle transition (nurture, recycled, disqualified, qualified, converted). */
  leadTransition: "crm.lead.transition",
  /** Convert a qualified lead to account/contact/opportunity (OP-001). */
  leadConvert: "crm.lead.convert",
  /** Close a deal as won or lost (OP-006). */
  closeDeal: "crm.deal.close",
  /** Transfer contact ownership to another agent (AS-002). */
  transferOwnership: "crm.contact.transfer",
  /**
   * Ingest an automatically captured email/calendar item (AC-004, WC-003).
   * Payload: { capturedId, source: 'email'|'calendar', externalId, contactId|null,
   * subject, occurredAt, participantCount, matchStatus, matchConfidence, rawRef }.
   * Fires when a mail/calendar connector posts an item to the capture endpoint.
   * NOTE: carries no message body and no participant addresses (DPDP).
   */
  captureActivity: "crm.activity.capture",
} as const;

export const EVENTS = {
  contactCreated: "crm.contact.created",
  contactUpdated: "crm.contact.updated",
  contactDeleted: "crm.contact.deleted",
  dealCreated: "crm.deal.created",
  dealStageUpdated: "crm.deal.stage_updated",
  dealUpdated: "crm.deal.updated",
  dealDeleted: "crm.deal.deleted",
  pipelineCreated: "crm.pipeline.created",
  pipelineUpdated: "crm.pipeline.updated",
  pipelineDeleted: "crm.pipeline.deleted",
  activityCreated: "crm.activity.created",
  activityUpdated: "crm.activity.updated",
  accountCreated: "crm.account.created",
  leadScoreRecalculated: "crm.lead.score_recalculated",
  /** Lead entity updated — consumed by ml-service for feature recomputation. */
  leadUpdated: "crm.lead.updated",
  /** Lead entity created — consumed by ml-service for initial scoring. */
  leadCreated: "crm.lead.created",
  // A logged customer complaint/escalation opens a CRM case (ticket-worthy).
  caseOpened: "crm.case.opened",
  /** Inbound lead captured and contact created from external channel. */
  leadCaptured: "crm.lead.captured",
  /** Lead status transitioned (nurture/recycled/disqualified/qualified/converted). */
  leadTransitioned: "crm.lead.transitioned",
  /** Lead converted to account/contact/deal (OP-001). */
  leadConverted: "crm.lead.converted",
  /** Deal closed as won or lost (OP-006). */
  dealClosed: "crm.deal.closed",
  /** Contact ownership transferred (AS-002). */
  ownershipTransferred: "crm.contact.ownership_transferred",

  // ── Sprint 2 ────────────────────────────────────────────────────────────────
  /** Strategic account plan created (KA-001). Payload: { planId, accountId, planYear }. */
  accountPlanCreated: "crm.account_plan.created",
  /** Account plan objectives/white-space/risks amended (KA-001). */
  accountPlanUpdated: "crm.account_plan.updated",
  /** Account plan moved from draft to active — it is now the governing plan (KA-001). */
  accountPlanActivated: "crm.account_plan.activated",
  /** Tender/RFP registered (KA-003). Payload: { tenderId, tenderRef, bidStage }. */
  tenderCreated: "crm.tender.created",
  /** Tender attributes amended (KA-003). */
  tenderUpdated: "crm.tender.updated",
  /** Bid stage transitioned (KA-003). Payload: { tenderId, fromStage, toStage }. */
  tenderStageChanged: "crm.tender.stage_changed",
  /** QBR booked for an account/quarter (KA-005). */
  qbrScheduled: "crm.qbr.scheduled",
  /** QBR held; outcomes recorded (KA-005). */
  qbrCompleted: "crm.qbr.completed",
  /** QBR cancelled with a reason (KA-005). */
  qbrCancelled: "crm.qbr.cancelled",
  /** Mandatory next action scheduled on a lead/deal (AC-002). */
  nextActionCreated: "crm.next_action.created",
  /** Next action completed (AC-002). */
  nextActionCompleted: "crm.next_action.completed",
  /** Email/calendar item captured against the CRM (AC-004, WC-003). */
  activityCaptured: "crm.activity.captured",
  /** A captured item was manually attached to a contact (AC-004). */
  activityCaptureMatched: "crm.activity.capture_matched",
  /** Recurring task definition created (AC-005). */
  recurringTaskCreated: "crm.recurring_task.created",
  /** Recurring task definition amended (AC-005). */
  recurringTaskUpdated: "crm.recurring_task.updated",
  /** Recurring task materialised its next occurrence (AC-005). */
  recurringTaskRun: "crm.recurring_task.run",
  /** Quotation created from a template (QP-003). Payload includes totalMinor as a STRING. */
  quotationCreated: "crm.quotation.created",
  /** New quotation revision cloned from an existing one (QP-003). */
  quotationVersioned: "crm.quotation.versioned",
  /** Quotation sent to the customer (QP-005). */
  quotationSent: "crm.quotation.sent",
  /** Quotation accepted by the customer (QP-005). */
  quotationAccepted: "crm.quotation.accepted",
  /** Quotation rejected with a reason (QP-005). */
  quotationRejected: "crm.quotation.rejected",
  /** Campaign responses/cost/revenue upserted for a period (MK-004). Money as STRINGS. */
  campaignPerformanceRecorded: "crm.campaign_performance.recorded",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  /** ml-service emits lead scored after computing conversion probability. */
  mlLeadScored: "ml.prediction.lead_scored",
} as const;

export const SERVICE = "crm";
export const RESOURCE = "contact";
