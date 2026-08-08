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
  feeScheduleCreate:       "citizen.fee_schedule.create",
  paymentIntentCreate:     "citizen.payment.intent_create",
  /** FN-14: gateway callback or labelled sandbox capture → receipt + GL. */
  paymentConfirm:          "citizen.payment.confirm",
  paymentOfflineRecord:    "citizen.payment.offline_record",
  refundRequest:           "citizen.refund.request",
  refundDecide:            "citizen.refund.decide",
  // SVC-086 issuance
  issuanceRequest:         "citizen.issuance.request",
  issuanceApprove:         "citizen.issuance.approve",
  issuanceAmend:           "citizen.issuance.amend",
  issuanceRenew:           "citizen.issuance.renew",
  issuanceRevoke:          "citizen.issuance.revoke",
  // P0 F3 batch 3 — sla-rules, appeal, catalogue, discovery, documents, eligibility
  slaRuleUpsert:           "citizen.sla_rule.upsert",
  appealFile:              "citizen.appeal.file",
  appealAssign:            "citizen.appeal.assign",
  appealTransferRecords:   "citizen.appeal.transfer_records",
  appealScheduleHearing:   "citizen.appeal.schedule_hearing",
  appealRecordHearing:     "citizen.appeal.record_hearing",
  appealPrepareOrder:      "citizen.appeal.prepare_order",
  appealIssueOrder:        "citizen.appeal.issue_order",
  catalogueDefinitionCreate:  "citizen.catalogue.definition_create",
  catalogueDefinitionUpdate:  "citizen.catalogue.definition_update",
  catalogueDefinitionSubmit:  "citizen.catalogue.definition_submit",
  catalogueDefinitionPublish: "citizen.catalogue.definition_publish",
  catalogueDefinitionReject:  "citizen.catalogue.definition_reject",
  sandboxTestRecord:          "citizen.sandbox_test.record",
  packServiceImport:          "citizen.pack.service_import",
  packServiceExport:          "citizen.pack.service_export",
  packDomainActivate:         "citizen.pack.domain_activate",
  discoveryConsentGrant:   "citizen.discovery.consent_grant",
  discoveryConsentRevoke:  "citizen.discovery.consent_revoke",
  discoveryRun:            "citizen.discovery.run",
  discoveryAssistedEnrol:  "citizen.discovery.assisted_enrol",
  documentUpload:          "citizen.document.upload",
  documentDigilockerFetch: "citizen.document.digilocker_fetch",
  documentVerify:          "citizen.document.verify",
  documentResubmit:        "citizen.document.resubmit",
  eligibilityRuleSetCreate:  "citizen.eligibility.ruleset_create",
  eligibilityRuleSetUpdate:  "citizen.eligibility.ruleset_update",
  eligibilityRuleSetSubmit:  "citizen.eligibility.ruleset_submit",
  eligibilityRuleSetPublish: "citizen.eligibility.ruleset_publish",
  eligibilityEvaluate:     "citizen.eligibility.evaluate",
  eligibilityReviewDecide: "citizen.eligibility.review_decide",
  // P0 F3 leftover — application intake drafts
  draftSave:               "citizen.application.draft_save",
  draftUpdate:             "citizen.application.draft_update",
  draftSubmit:             "citizen.application.draft_submit",
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
