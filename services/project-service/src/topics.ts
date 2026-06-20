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

export const SERVICE = "project";
