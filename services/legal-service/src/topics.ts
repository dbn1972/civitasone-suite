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
  counselBriefAssign:   "legal.counsel_brief.assign",
  filingRecord:         "legal.filing.record",
} as const;

export const EVENTS = {
  caseDateSet:            "legal.case.date_set",
  contractReviewCleared:  "legal.contract_review.cleared",
  opinionIssued:          "legal.opinion.issued",
  counselBriefAssigned:   "legal.counsel_brief.assigned",
  filingRecorded:         "legal.filing.recorded",
} as const;

export const SERVICE = "legal";
