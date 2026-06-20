/** Topic + event names owned by helpdesk-service. */
export const COMMANDS = {
  createTicket: "helpdesk.ticket.create",
} as const;

export const EVENTS = {
  ticketCreated: "helpdesk.ticket.created",
} as const;

export const SERVICE = "helpdesk";
export const RESOURCE = "ticket";
