/** Topic + event names owned by crm-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createContact: "crm.contact.create",
  updateContact: "crm.contact.update",
  deleteContact: "crm.contact.delete",
  mergeContacts: "crm.contact.merge",
  bulkImportContacts: "crm.contact.bulk_import",
  createDeal: "crm.deal.create",
  updateDealStage: "crm.deal.update_stage",
  createActivity: "crm.activity.create",
  createAccount: "crm.account.create",
} as const;

export const EVENTS = {
  contactCreated: "crm.contact.created",
  contactUpdated: "crm.contact.updated",
  contactDeleted: "crm.contact.deleted",
  dealCreated: "crm.deal.created",
  dealStageUpdated: "crm.deal.stage_updated",
  activityCreated: "crm.activity.created",
  accountCreated: "crm.account.created",
} as const;

export const SERVICE = "crm";
export const RESOURCE = "contact";
