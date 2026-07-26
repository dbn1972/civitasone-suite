export const COMMANDS = {
  projectCreate:           "project.project.create",
  taskCreate:              "project.task.create",
  taskStatusUpdate:        "project.task.status",
  milestoneCreate:         "project.milestone.create",
  milestoneComplete:       "project.milestone.complete",
  schemeCreate:            "project.scheme.create",
  schemeComponentCreate:   "project.scheme_component.create",
  fundReleaseCreate:       "project.fund_release.create",
  fundReleaseDisburse:     "project.fund_release.disburse",
  physicalProgressRecord:  "project.physical_progress.record",
  financialProgressRecord: "project.financial_progress.record",
  dprSubmit:               "project.dpr.submit",
  ucSubmit:                "project.uc.submit",
  geoTag:                  "project.geo.tag",
  photoUpload:             "project.photo.upload",
} as const;

export const EVENTS = {
  projectCreated:          "project.project.created",
  taskCreated:             "project.task.created",
  taskStatusUpdated:       "project.task.status_updated",
  /** Task updated (progress, assignment, dates) — consumed by ml-service for delay risk re-computation. */
  taskUpdated:             "project.task.updated",
  milestoneCompleted:      "project.milestone.completed",
  schemeCreated:           "project.scheme.created",
  fundReleaseApproved:     "project.fund_release.approved",
  fundReleaseAllocationExceeded: "project.fund_release.allocation_exceeded",
  fundReleaseDisbursed:    "project.fund_release.disbursed",
  physicalProgressRecorded: "project.physical_progress.recorded",
  dprSubmitted:            "project.dpr.submitted",
  ucSubmitted:             "project.uc.submitted",
  ucExpenditureExceeded:   "project.uc.expenditure_exceeded",
  geoTagged:               "project.geo.tagged",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  // meeting-service board/committee free-text project decision (Req 22.4). Opens a
  // PENDING_REVIEW triage item — see modules/board-intake/consumer.ts. Payload:
  // { decisionId, meetingId, text, projectRef?, authority?, effectiveDate?, committeeId? }.
  boardDecisionProject: "meeting.decision.project",
} as const;

export const SERVICE = "project";
