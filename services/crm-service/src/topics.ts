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
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  /** ml-service emits lead scored after computing conversion probability. */
  mlLeadScored: "ml.prediction.lead_scored",
} as const;

export const SERVICE = "crm";
export const RESOURCE = "contact";
