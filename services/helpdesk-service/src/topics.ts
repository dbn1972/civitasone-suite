/** Topic + event names owned by helpdesk-service. */
export const COMMANDS = {
  createTicket: "helpdesk.ticket.create",
  assignTicket: "helpdesk.ticket.assign",
  transitionTicket: "helpdesk.ticket.transition",
} as const;

export const EVENTS = {
  ticketCreated: "helpdesk.ticket.created",
  ticketAssigned: "helpdesk.ticket.assigned",
  ticketEscalated: "helpdesk.ticket.escalated",
  ticketTransitioned: "helpdesk.ticket.transitioned",
} as const;

/** Foreign producer topics this service CONSUMES (HD2 inbound linkage). */
export const CONSUMES = {
  // A missed telephony call auto-opens a linked helpdesk ticket (callback request).
  telephonyCallMissed: "telephony.call.missed",
  // A CRM complaint/case opens a linked helpdesk ticket (chain #5).
  crmCaseOpened: "crm.case.opened",
} as const;

/** source tag stamped on tickets auto-opened from a foreign event. */
export const SOURCE = {
  telephony: "telephony",
  crm: "crm",
} as const;

export const SERVICE = "helpdesk";
export const RESOURCE = "ticket";
