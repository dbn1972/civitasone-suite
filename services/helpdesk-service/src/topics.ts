/** Topic + event names owned by helpdesk-service. */
export const COMMANDS = {
  createTicket: "helpdesk.ticket.create",
  assignTicket: "helpdesk.ticket.assign",
  transitionTicket: "helpdesk.ticket.transition",
  /** TKT-04 — add internal/public note to a ticket. */
  addNote: "helpdesk.ticket.add_note",
  /** TKT-07 — transfer ticket to another department. */
  transferTicket: "helpdesk.ticket.transfer",
  /** TKT-08 — link two tickets (parent/child/duplicate/related). */
  linkTickets: "helpdesk.ticket.link",
  /** TKT-09 — bulk action on up to 50 tickets. */
  bulkAction: "helpdesk.ticket.bulk_action",
  /** TKT-14 — reopen a closed/resolved ticket. */
  reopenTicket: "helpdesk.ticket.reopen",
  // T2-04 automation
  automationRuleCreate: "helpdesk.automation.rule_create",
  automationRuleUpdate: "helpdesk.automation.rule_update",
  automationRuleDelete: "helpdesk.automation.rule_delete",
  // T2-04 sla
  slaPolicyUpsert: "helpdesk.sla.policy_upsert",
  csatSubmit: "helpdesk.csat.submit",
  ticketEscalate: "helpdesk.ticket.escalate",
  // Routing module
  routingRuleCreate: "helpdesk.routing.rule_create",
  routingRuleUpdate: "helpdesk.routing.rule_update",
  routingRuleDelete: "helpdesk.routing.rule_delete",
  routingCapacityUpsert: "helpdesk.routing.capacity_upsert",
  routingQueueEnqueue: "helpdesk.routing.queue_enqueue",
  routingQueueDequeue: "helpdesk.routing.queue_dequeue",
  // Service catalogue (SVC-129)
  catalogueOfferingCreate: "helpdesk.catalogue.offering_create",
  catalogueOfferingUpdate: "helpdesk.catalogue.offering_update",
  catalogueOlaCreate: "helpdesk.catalogue.ola_create",
  catalogueRequestRaise: "helpdesk.catalogue.request_raise",
  catalogueRequestApprove: "helpdesk.catalogue.request_approve",
  catalogueRequestAdvance: "helpdesk.catalogue.request_advance",
  catalogueRequestFulfil: "helpdesk.catalogue.request_fulfil",
} as const;

/** TKT-11 — saved-views command topics (moved here from views-routes.ts so
 * the views consumer can share the same source of truth as the routes). */
export const VIEW_COMMANDS = {
  create: "helpdesk.view.create",
  update: "helpdesk.view.update",
  delete: "helpdesk.view.delete",
} as const;

export const EVENTS = {
  ticketCreated: "helpdesk.ticket.created",
  /** Ticket updated (status, assignment, priority change) — consumed by ml-service for breach risk re-scoring. */
  ticketUpdated: "helpdesk.ticket.updated",
  ticketAssigned: "helpdesk.ticket.assigned",
  ticketEscalated: "helpdesk.ticket.escalated",
  ticketTransitioned: "helpdesk.ticket.transitioned",
  /** TKT-04 — note added to ticket (internal or public). */
  noteAdded: "helpdesk.ticket.note_added",
  /** TKT-07 — ticket transferred between departments. */
  ticketTransferred: "helpdesk.ticket.transferred",
  /** TKT-08 — tickets linked (parent/child/duplicate/related). */
  ticketsLinked: "helpdesk.ticket.linked",
  /** TKT-14 — ticket reopened from resolved/closed. */
  ticketReopened: "helpdesk.ticket.reopened",
  /** TKT-11 — saved view lifecycle. */
  viewCreated: "helpdesk.view.created",
  viewUpdated: "helpdesk.view.updated",
  viewDeleted: "helpdesk.view.deleted",
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
