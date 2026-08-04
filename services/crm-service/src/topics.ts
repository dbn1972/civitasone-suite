/** Topic + event names owned by crm-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createContact: "crm.contact.create",
  updateContact: "crm.contact.update",
  deleteContact: "crm.contact.delete",
  mergeContacts: "crm.contact.merge",
  /** Merge two lead (contact) records, reassigning children to the primary (DQ-002). */
  mergeLeads: "crm.lead.merge",
  /** Merge two account records, reassigning children to the primary (DQ-002). */
  mergeAccounts: "crm.account.merge",
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
  // F3 leftover — roles / teams / quotations sync writes
  createContactRole: "crm.contact_role.create",
  deleteContactRole: "crm.contact_role.delete",
  createTeam: "crm.team.create",
  updateAgentCapacity: "crm.agent_workload.update_capacity",
  createQuotation: "crm.quotation.create",
  versionQuotation: "crm.quotation.version",
  sendQuotation: "crm.quotation.send",
  acceptQuotation: "crm.quotation.accept",
  rejectQuotation: "crm.quotation.reject",
  /**
   * Ingest an automatically captured email/calendar item (AC-004, WC-003).
   * Payload: { capturedId, source: 'email'|'calendar', externalId, contactId|null,
   * subject, occurredAt, participantCount, matchStatus, matchConfidence, rawRef }.
   * Fires when a mail/calendar connector posts an item to the capture endpoint.
   * NOTE: carries no message body and no participant addresses (DPDP).
   */
  captureActivity: "crm.activity.capture",
  /**
   * Configure which lead fields are mandatory / how they score (LM-001).
   * Payload: { tenantId, fieldName, required, weight, enabled, actorId }.
   * Fires when an admin PUTs a lead field rule. Upserts on (tenantId, fieldName).
   */
  upsertLeadFieldRule: "crm.lead_field_rule.upsert",
  /**
   * Remove a lead field rule so the field reverts to built-in behaviour (LM-001).
   * Payload: { tenantId, fieldName }.
   */
  deleteLeadFieldRule: "crm.lead_field_rule.delete",
  createCustomField: "crm.custom_field.create",
  updateCustomField: "crm.custom_field.update",
  deleteCustomField: "crm.custom_field.delete",
  // F3 residual — tenders / next-actions / recurring / plans / qbr / capture / campaign-roi
  createTender: "crm.tender.create",
  updateTender: "crm.tender.update",
  changeTenderStage: "crm.tender.stage_change",
  createNextAction: "crm.next_action.create",
  completeNextAction: "crm.next_action.complete",
  createRecurringTask: "crm.recurring_task.create",
  updateRecurringTask: "crm.recurring_task.update",
  runRecurringTask: "crm.recurring_task.run",
  createAccountPlan: "crm.account_plan.create",
  updateAccountPlan: "crm.account_plan.update",
  activateAccountPlan: "crm.account_plan.activate",
  scheduleQbr: "crm.qbr.schedule",
  completeQbr: "crm.qbr.complete",
  cancelQbr: "crm.qbr.cancel",
  matchCapturedActivity: "crm.activity.capture_match",
  upsertCampaignPerformance: "crm.campaign_performance.upsert",
  /** Set / clear account parentId with cycle checks done at the route boundary (CM-002). */
  setAccountParent: "crm.account.set_parent",
  /** Move a customer onboarding case to its next stage (P1-9). */
  advanceOnboardingStage: "crm.onboarding_case.advance_stage",
  /** Record a KYC outcome against an onboarding case (P1-9). */
  recordOnboardingKyc: "crm.onboarding_case.record_kyc",
  /**
   * Score an interaction's text for Voice-of-Customer reporting (P2-6).
   * Payload: { activityId, activityType, contactId, dealId, text }.
   * The ONLY crm topic that carries interaction text — deliberately narrow, so the
   * customer's words are not broadcast to every consumer of activity events (DPDP).
   */
  analyseSentiment: "crm.sentiment.analyse",
  /** Set lead classification (temperature/priority/segment/product/region/expected value) (LQ-003). */
  classifyContact: "crm.contact.classify",
  /** Submit a qualification framework's answers for a lead -> compute outcome+score (LQ-001). */
  qualifyLead: "crm.lead.qualify",
  // ── Lead assignment & escalation (AS-001..004) ──
  createAssignmentRule: "crm.assignment_rule.create",
  updateAssignmentRule: "crm.assignment_rule.update",
  deleteAssignmentRule: "crm.assignment_rule.delete",
  assignLeadManual: "crm.lead.assign",
  acceptLead: "crm.lead.accept",
  createAssignmentQueue: "crm.assignment_queue.create",
  deleteAssignmentQueue: "crm.assignment_queue.delete",
  createTerritory: "crm.territory.create",
  deleteTerritory: "crm.territory.delete",
  createPartner: "crm.partner.create",
  deletePartner: "crm.partner.delete",
  createBranch: "crm.branch.create",
  deleteBranch: "crm.branch.delete",
  upsertEscalationRule: "crm.escalation_rule.upsert",
  deleteEscalationRule: "crm.escalation_rule.delete",
} as const;

export const EVENTS = {
  contactCreated: "crm.contact.created",
  contactUpdated: "crm.contact.updated",
  contactDeleted: "crm.contact.deleted",
  /** Two leads merged; payload { leadId, mergedFrom } (DQ-002). */
  leadMerged: "crm.lead.merged",
  /** Two accounts merged; payload { accountId, mergedFrom } (DQ-002). */
  accountMerged: "crm.account.merged",
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
  /**
   * A tenant's mandatory-field configuration changed (LM-001).
   * Payload: { fieldName, required, weight, enabled } — configuration only, no lead data.
   * MUST stay distinct from COMMANDS.upsertLeadFieldRule: the consumer of that command
   * emits this, and sharing the string would make it re-consume its own event.
   */
  leadFieldRuleUpserted: "crm.lead_field_rule.upserted",
  /** A lead field rule was removed; the field reverts to built-in behaviour (LM-001). */
  leadFieldRuleDeleted: "crm.lead_field_rule.deleted",
  customFieldCreated: "crm.custom_field.created",
  customFieldUpdated: "crm.custom_field.updated",
  customFieldDeleted: "crm.custom_field.deleted",

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
  /**
   * Recurring task materialised its next occurrence (AC-005).
   *
   * MUST NOT reuse `COMMANDS.runRecurringTask` ("crm.recurring_task.run").
   * The consumer of that command emits this event, so sharing the string made
   * the consumer re-consume its own completion event as a fresh command. The
   * event payload ({ taskId, materialisedActionId }) has none of the fields
   * the command handler reads ({ id, tenantId, version }), so the guarded
   * UPDATE rendered `WHERE id =  AND tenant_id = ...` and failed with
   * SQLSTATE 42601. That rolled back `markProcessed`, so the message was
   * redelivered forever and every genuine run fed the loop again.
   *
   * Payload: { taskId, materialisedActionId, dueAt, nextRunAt }.
   */
  recurringTaskRan: "crm.recurring_task.ran",
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
  /** Account parent hierarchy changed (CM-002). */
  accountParentSet: "crm.account.parent_set",

  // ── Customer onboarding (P1-9) ──────────────────────────────────────────────
  /**
   * Onboarding case raised because a deal reached Won.
   * Payload: { caseId, dealId, accountId, stage, kycStatus }.
   */
  onboardingCaseOpened: "crm.onboarding_case.opened",
  /** Onboarding case moved stage. Payload: { caseId, fromStage, toStage }. */
  onboardingStageAdvanced: "crm.onboarding_case.stage_advanced",
  /**
   * KYC outcome recorded on an onboarding case.
   * Payload: { caseId, fromStatus, toStatus } — never the provider reference.
   */
  onboardingKycRecorded: "crm.onboarding_case.kyc_recorded",

  // ── Voice of Customer (P2-6) ────────────────────────────────────────────────
  /**
   * An interaction was scored for sentiment.
   * Payload: { activityId, polarity, score, themes, model } — never the text.
   */
  sentimentScored: "crm.interaction.sentiment_scored",

  /** Lead classification fields changed (LQ-003). Payload: { contactId, fields }. */
  contactClassified: "crm.contact.classified",
  /** A lead was qualified against a framework (LQ-001). Payload: { leadId, frameworkId, outcome, score }. */
  leadQualified: "crm.lead.qualified",
  // ── Lead assignment & escalation (AS-001..004) ──
  assignmentRuleCreated: "crm.assignment_rule.created",
  assignmentRuleUpdated: "crm.assignment_rule.updated",
  assignmentRuleDeleted: "crm.assignment_rule.deleted",
  leadAssigned: "crm.lead.assigned",
  leadAccepted: "crm.lead.accepted",
  leadEscalated: "crm.lead.escalated",
  escalationRuleUpserted: "crm.escalation_rule.upserted",
  escalationRuleDeleted: "crm.escalation_rule.deleted",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  /** ml-service emits lead scored after computing conversion probability. */
  mlLeadScored: "ml.prediction.lead_scored",
} as const;

export const SERVICE = "crm";
export const RESOURCE = "contact";
