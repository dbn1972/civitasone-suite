/**
 * Topic + event names owned by court-service. Naming: {service}.{entity}.{action}
 *
 * This file is the single source of truth for the court-service message contract.
 * - COMMANDS         — write intents published by routes (route → zod → queue.publish → 202)
 * - EVENTS           — domain facts published via the transactional outbox after a DB write
 * - CONSUMED_EVENTS  — events owned by OTHER services that court-service subscribes to
 *
 * Each entry carries a JSDoc payload contract describing the message body. All payloads are
 * wrapped in the standard CivitasOne CommandEnvelope (`{ messageId, tenantId, actorId,
 * correlationId, occurredAt, payload }`); the JSDoc below documents the `payload` shape only.
 *
 * Cross-service contract note (per steering docs): when a CONSUMED_EVENT contract changes, the
 * publisher's topics.ts and this file must be updated together. Consumers MUST tolerate unknown
 * additional fields (forward-compatible) and treat new optional fields as additive.
 *
 * _Requirements: 25.3, 22.6, 22.7_
 */

/**
 * Commands — write intents. Published by HTTP routes after zod validation; handled by consumers
 * which call markProcessed(tx, messageId) first, then write, then enqueue EVENTS.
 */
export const COMMANDS = {
  /** payload: { cnr?, caseType, filingNumber?, courtId, title, petitioners, respondents, actSection?, filedAt } */
  registerCase:               "court.case.register",
  /** payload: { caseId, version, to: CaseStatus, reason?, disposalType? } */
  updateCaseStatus:           "court.case.update_status",
  /** payload: { caseId, courtId, scheduledAt, purpose?, benchId?, judgeIds? } */
  scheduleHearing:            "court.hearing.schedule",
  /** payload: { hearingId, reason, nextDate, expectedVersion } — §20 adjourn a hearing */
  adjournHearing:             "court.hearing.adjourn",
  /** payload: { caseId, hearingId?, orderType, text, judgeIds?, effectiveDate? } */
  recordOrder:                "court.order.record",
  /** payload: { caseId, filingType, filedBy, documentIds?, feePaid? } */
  submitFiling:               "court.filing.submit",
  /** payload: { courtId, forDate, benchId? } — materialize the cause-list for a court/day */
  generateCauseList:          "court.causelist.generate",
  /** payload: { id, courtId, listDate, benchId?, listType? } — list a case onto a slot */
  listCaseOnCauseList:        "court.causelist.list_case",
  /** §13 registry scrutiny + defect management */
  recordScrutiny:             "court.scrutiny.record",
  raiseDefect:                "court.defect.raise",
  resolveDefect:              "court.defect.resolve",
  /** §21 issuance + service of process */
  issueNotice:                "court.notice.issue",
  recordService:              "court.notice.serve",
  updateNoticeStatus:         "court.notice.update_status",
  /** §26 execution + compliance monitoring */
  createDirection:            "court.compliance.direct",
  updateCompliance:           "court.compliance.update",
  /** §25 appeal / revision / review */
  fileAppeal:                 "court.appeal.file",
  registerAppeal:             "court.appeal.register",
  decideAppeal:               "court.appeal.decide",
  withdrawAppeal:             "court.appeal.withdraw",
  /** §14/§15 parties + advocates (PII encrypted at rest) */
  addParty:                   "court.party.add",
  updateAdvocate:             "court.party.update_advocate",
  /** §22 evidence + exhibits (SHA-256 tamper-evidence) */
  submitEvidence:             "court.evidence.submit",
  ruleOnEvidence:             "court.evidence.rule",
  /** §23/§35.5 order issuance — maker-checker + DSC; AI never issues */
  submitOrderForApproval:     "court.order.submit_approval",
  approveAndIssueOrder:       "court.order.approve_issue",
  sendBackOrder:              "court.order.send_back",
  recallOrder:                "court.order.recall",
  /** payload: { id, name, courtType, jurisdiction?, establishmentCode?, parentCourtId?, address? } — §7 court master */
  createCourt:                "court.court.create",
  /** payload: { id, courtId, name, presidingJudgeId?, benchType? } — §5.2 bench under a court */
  createBench:                "court.bench.create",
} as const;

/**
 * Events — domain facts emitted via the transactional outbox after a successful DB write.
 * Consumed by Audit_Service, Analytics_Service, Notification_Service, and other services.
 * All event payloads include at minimum: { caseId?, tenantId, occurredAt } plus the fields below.
 */
export const EVENTS = {
  /** payload: { caseId, cnr, caseType, courtId, status: "filed" } */
  caseRegistered:             "court.case.registered",
  /** payload: { caseId, from, to, reason?, disposalType? } */
  caseStatusChanged:          "court.case.status_changed",
  /** payload: { caseId, hearingId, courtId, scheduledAt, purpose? } */
  hearingScheduled:           "court.hearing.scheduled",
  /** payload: { hearingId, nextDate, reason } */
  hearingAdjourned:           "court.hearing.adjourned",
  /** payload: { caseId, orderId, orderType, effectiveDate? } */
  orderRecorded:              "court.order.recorded",
  /** payload: { caseId, filingId, filingType, filedBy } */
  filingSubmitted:            "court.filing.submitted",
  /** payload: { courtId, causeListId, forDate, itemCount } */
  causeListGenerated:         "court.causelist.generated",
  /** payload: { causeListId, caseId, slot, courtroom } */
  causeListItemAdded:         "court.causelist.item_added",
  scrutinyRecorded:           "court.scrutiny.recorded",
  defectRaised:               "court.defect.raised",
  defectResolved:             "court.defect.resolved",
  noticeIssued:               "court.notice.issued",
  noticeServiceRecorded:      "court.notice.service_recorded",
  noticeStatusChanged:        "court.notice.status_changed",
  complianceDirected:         "court.compliance.directed",
  complianceUpdated:          "court.compliance.updated",
  appealFiled:                "court.appeal.filed",
  appealStatusChanged:        "court.appeal.status_changed",
  partyAdded:                 "court.party.added",
  advocateUpdated:            "court.party.advocate_updated",
  evidenceSubmitted:          "court.evidence.submitted",
  evidenceRuled:              "court.evidence.ruled",
  orderPendingApproval:       "court.order.pending_approval",
  orderIssued:                "court.order.issued",
  orderSentBack:              "court.order.sent_back",
  orderRecalled:              "court.order.recalled",
  /** payload: { courtId, courtType, name } */
  courtRegistered:            "court.court.registered",
  /** payload: { benchId, courtId, name } */
  benchRegistered:            "court.bench.registered",
} as const;

/**
 * Consumed events — owned by other services. court-service subscribes to these to stitch
 * cross-service behavior. Consumers MUST be idempotent and tolerate unknown extra fields.
 *
 * Cross-service contracts (payload shapes as guaranteed by the publishing service):
 */
export const CONSUMED_EVENTS = {} as const;

/** Service identifier — first segment of every owned topic name. */
export const SERVICE = "court";
