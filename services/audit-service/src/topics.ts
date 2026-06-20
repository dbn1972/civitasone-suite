export const CONSUME_TOPICS = {
  auditEventIngest: "audit.event.ingest",
  auditEventRecord: "audit.event.record",
} as const;

export const COMMANDS = {
  planCreate:            "audit.plan.create",
  planItemCreate:        "audit.plan_item.create",
  planStart:             "audit.plan.start",
  observationCreate:     "audit.observation.create",
  paraDraft:             "audit.para.draft",
  paraIssue:             "audit.para.issue",
  paraDeptResponse:      "audit.para.dept_response",
  paraSettle:            "audit.para.settle",
  paraPendingRecovery:   "audit.para.pending_recovery",
  paraClose:             "audit.para.close",
  pendingRegisterCreate: "audit.pending_register.create",
  exportCreate:          "audit.export.create",
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
};
