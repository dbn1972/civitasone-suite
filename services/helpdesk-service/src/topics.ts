/** Topic + event names owned by helpdesk-service. */
export const COMMANDS = {
  createTicket: "helpdesk.ticket.create",
  assignTicket: "helpdesk.ticket.assign",
  transitionTicket: "helpdesk.ticket.transition",
} as const;

export const EVENTS = {
  ticketCreated: "helpdesk.ticket.created",
  /** Ticket updated (status, assignment, priority change) — consumed by ml-service for breach risk re-scoring. */
  ticketUpdated: "helpdesk.ticket.updated",
  ticketAssigned: "helpdesk.ticket.assigned",
  ticketEscalated: "helpdesk.ticket.escalated",
  ticketTransitioned: "helpdesk.ticket.transitioned",
  // SVC-129 — service catalogue / self-service request lifecycle.
  requestRaised: "helpdesk.request.raised",
  requestApproved: "helpdesk.request.approved",
  requestRejected: "helpdesk.request.rejected",
  requestStageAdvanced: "helpdesk.request.stage_advanced",
  requestFulfilled: "helpdesk.request.fulfilled",
  requestBreachEscalated: "helpdesk.request.breach_escalated",
} as const;

/** Foreign producer topics this service CONSUMES (HD2 inbound linkage). */
export const CONSUMES = {
  // A missed telephony call auto-opens a linked helpdesk ticket (callback request).
  telephonyCallMissed: "telephony.call.missed",
  // A CRM complaint/case opens a linked helpdesk ticket (chain #5).
  crmCaseOpened: "crm.case.opened",
  /** ml-service emits breach risk high when ticket breach probability > 0.70. */
  mlBreachRiskHigh: "ml.prediction.breach_risk_high",
  /** citizen-service request creates a linked helpdesk ticket for department handling. */
  citizenRequestCreated: "citizen.request.created",
} as const;

/** source tag stamped on tickets auto-opened from a foreign event. */
export const SOURCE = {
  telephony: "telephony",
  crm: "crm",
  // LOOP 1 — knowledge-service assistant escalate-to-ticket handoff.
  assistant: "knowledge_assistant",
  citizen: "citizen",
} as const;

export const SERVICE = "helpdesk";
export const RESOURCE = "ticket";
export const RESOURCE_REQUEST = "service_request";
