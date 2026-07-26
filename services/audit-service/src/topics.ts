/**
 * Topics owned by audit-service's namespace that OTHER services publish into.
 * Every service emits `audit.event.record` via its outbox; audit ingests them.
 */
export const CONSUMED_EVENTS = {
  auditEventIngest: "audit.event.ingest",
  auditEventRecord: "audit.event.record",
} as const;

export const COMMANDS = {
  planCreate:            "audit.plan.create",
  planItemCreate:        "audit.plan_item.create",
  planStart:             "audit.plan.start",
  observationCreate:     "audit.observation.create",
  // AU-01: auditee reply and auditor review commands
  observationReply:      "audit.observation.reply",
  observationReview:     "audit.observation.review",
  // P1-6: observation closure (full / partial)
  observationClose:      "audit.observation.close",
  // P1-7: risk register + risk-driven planning
  riskCreate:            "audit.risk.create",
  riskUpdate:            "audit.risk.update",
  riskLinkPlan:          "audit.risk.link_plan",
  paraDraft:             "audit.para.draft",
  paraIssue:             "audit.para.issue",
  paraDeptResponse:      "audit.para.dept_response",
  paraSettle:            "audit.para.settle",
  paraPendingRecovery:   "audit.para.pending_recovery",
  paraClose:             "audit.para.close",
  pendingRegisterCreate: "audit.pending_register.create",
  exportCreate:          "audit.export.create",
  vigilanceIntake:        "audit.vigilance.intake",
  vigilanceScreen:        "audit.vigilance.screen",
  vigilanceAssignIo:      "audit.vigilance.assign_io",
  vigilanceEvidence:      "audit.vigilance.evidence",
  vigilanceFindings:      "audit.vigilance.findings",
  vigilanceProposeAction: "audit.vigilance.propose_action",
  vigilanceDecideAction:  "audit.vigilance.decide_action",
  riskControlCreate:      "audit.risk_control.create",
  riskControlTest:        "audit.risk_control.test",
  riskIncidentCreate:     "audit.risk_incident.create",
  riskMitigationCreate:   "audit.risk_mitigation.create",
  riskAcceptancePropose:  "audit.risk_acceptance.propose",
  riskAcceptanceDecide:   "audit.risk_acceptance.decide",
  riskReview:             "audit.risk.review",
} as const;

export const EVENTS = {
  exportRequested:     "audit.export.requested",
  paraIssued:          "audit.para.issued",
  paraPendingRecovery: "audit.para.pending_recovery",
} as const;

export const SERVICE = "audit";
export const RESOURCE = {
  event:  "event",
  export: "export",
  plan:   "plan",
  para:   "para",
  risk:   "risk",
};
