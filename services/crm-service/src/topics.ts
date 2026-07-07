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
  // A logged customer complaint/escalation opens a CRM case (ticket-worthy).
  caseOpened: "crm.case.opened",
} as const;

export const SERVICE = "crm";
export const RESOURCE = "contact";
