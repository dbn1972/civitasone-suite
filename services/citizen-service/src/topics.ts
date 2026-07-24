/** Topic + event names owned by citizen-service. {service}.{entity}.{action} */

export const COMMANDS = {
  profileCreate:           "citizen.profile.create",
  applicationSubmit:       "citizen.application.submit",
  applicationStatusUpdate: "citizen.application.status_update",
  applicationDocUpload:    "citizen.application.doc_upload",
  grievanceRegister:       "citizen.grievance.register",
  grievanceAssign:         "citizen.grievance.assign",
  grievanceAction:         "citizen.grievance.action",
  grievanceResolve:        "citizen.grievance.resolve",
  grievanceEscalate:       "citizen.grievance.escalate",
  grievanceReopen:         "citizen.grievance.reopen",
  profileDelete:           "citizen.profile.delete",
  rtiFile:                 "citizen.rti.file",
  rtiResponseReceive:      "citizen.rti.response_receive",
  rtiAppeal:               "citizen.rti.appeal",
  rtiTransfer:             "citizen.rti.transfer",
  ticketCreate:            "citizen.ticket.create",
  ticketNote:              "citizen.ticket.note",
  ticketClose:             "citizen.ticket.close",
  ticketAssign:            "citizen.ticket.assign",
  ticketResolve:           "citizen.ticket.resolve",
  ticketEscalate:          "citizen.ticket.escalate",
  applicationSlaCheck:     "citizen.application.sla_check",
  grievanceSlaCheck:       "citizen.grievance.sla_check",
  ticketSlaCheck:          "citizen.ticket.sla_check",
  rtiSlaCheck:             "citizen.rti.sla_check",
  // SVC-085 fee & payment
  paymentRequested:        "citizen.payment.requested",
} as const;

export const EVENTS = {
  applicationApproved:    "citizen.application.approved",
  applicationSlaBreached: "citizen.application.sla_breached",
  grievanceResolved:      "citizen.grievance.resolved",
  grievanceReopened:      "citizen.grievance.reopened",
  rtiFiled:               "citizen.rti.filed",
  rtiTransferred:         "citizen.rti.transferred",
  grievanceEscalated:     "citizen.grievance.escalated",
  profileDeleted:         "citizen.profile.deleted",
  ticketSlaBreached:      "citizen.ticket.sla_breached",
  rtiSlaBreached:         "citizen.rti.sla_breached",
  // SVC-083 eligibility
  eligibilityRuleSetPublished: "citizen.eligibility.ruleset_published",
  // SVC-085 fee & payment
  receiptIssued:          "citizen.receipt.issued",
  // SVC-086 issuance
  certificateIssued:      "citizen.certificate.issued",
  certificateRevoked:     "citizen.certificate.revoked",
  // SVC-090 proactive discovery
  serviceDiscovered:      "citizen.discovery.service_discovered",
  // SVC-081 government service catalogue
  serviceDefinitionPublished: "citizen.catalogue.published",
  // SVC-084 document submission & verification
  documentVerified:       "citizen.document.verified",
  // SVC-089 appeal, review & revision
  appealFiled:            "citizen.appeal.filed",
  appealDecided:          "citizen.appeal.decided",
} as const;

export const CONSUMED_EVENTS = {
  estabRtiResponded: "estab.rti.responded",
} as const;

export const SERVICE = "citizen";
