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
  ticketCreate:            "citizen.ticket.create",
  ticketNote:              "citizen.ticket.note",
  ticketClose:             "citizen.ticket.close",
  ticketAssign:            "citizen.ticket.assign",
  ticketResolve:           "citizen.ticket.resolve",
  ticketEscalate:          "citizen.ticket.escalate",
  applicationSlaCheck:     "citizen.application.sla_check",
  grievanceSlaCheck:       "citizen.grievance.sla_check",
} as const;

export const EVENTS = {
  applicationApproved:    "citizen.application.approved",
  applicationSlaBreached: "citizen.application.sla_breached",
  grievanceResolved:      "citizen.grievance.resolved",
  grievanceReopened:      "citizen.grievance.reopened",
  rtiFiled:               "citizen.rti.filed",
  grievanceEscalated:     "citizen.grievance.escalated",
  profileDeleted:         "citizen.profile.deleted",
  ticketSlaBreached:      "citizen.ticket.sla_breached",
} as const;

export const CONSUMED_EVENTS = {
  estabRtiResponded: "estab.rti.responded",
} as const;

export const SERVICE = "citizen";
