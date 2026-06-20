/** Topic + event names owned by crm-service. {service}.{entity}.{action} */
export const COMMANDS = {
  createContact: "crm.contact.create",
  createDeal: "crm.deal.create",
  createActivity: "crm.activity.create",
} as const;

export const EVENTS = {
  contactCreated: "crm.contact.created",
  dealCreated: "crm.deal.created",
  activityCreated: "crm.activity.created",
} as const;

export const SERVICE = "crm";
export const RESOURCE = "contact";
