export const COMMANDS = {
  caseCreate:           "legal.case.create",
  hearingCreate:        "legal.hearing.create",
  hearingAdjourn:       "legal.hearing.adjourn",
  orderRecord:          "legal.order.record",
  caseDispose:          "legal.case.dispose",
  noticeCreate:         "legal.notice.create",
  noticeRespond:        "legal.notice.respond",
  contractReviewCreate: "legal.contract_review.create",
  contractReviewClear:  "legal.contract_review.clear",
  settlementCreate:     "legal.settlement.create",
  opinionSeek:          "legal.opinion.seek",
  opinionDraft:         "legal.opinion.draft",
  opinionIssue:         "legal.opinion.issue",
  opinionSubmitApproval: "legal.opinion.submit_approval",
  counselBriefAssign:   "legal.counsel_brief.assign",
  filingRecord:         "legal.filing.record",
  reminderCreate:       "legal.reminder.create",
  documentCreate:       "legal.document.create",
  documentUpdate:       "legal.document.update",
  documentDelete:       "legal.document.delete",
  documentHoldApply:    "legal.document.hold_apply",
  documentHoldRelease:  "legal.document.hold_release",
  limitationCreate:     "legal.limitation.create",
  limitationUpdate:     "legal.limitation.update",
  limitationDelete:     "legal.limitation.delete",
} as const;

export const EVENTS = {
  caseDateSet:            "legal.case.date_set",
  contractReviewCleared:  "legal.contract_review.cleared",
  opinionIssued:          "legal.opinion.issued",
  counselBriefAssigned:   "legal.counsel_brief.assigned",
  filingRecorded:         "legal.filing.recorded",
} as const;

/** Topics consumed from other services (cross-service stitching) */
export const CONSUMED_EVENTS = {
  // eOffice decision callback for legal opinions raised into the approval backbone.
  opinionFileDecided: "legal.opinion.file_decided",
} as const;

export const SERVICE = "legal";
