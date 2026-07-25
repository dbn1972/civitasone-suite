export const COMMANDS = {
  indentCreate:    "procurement.indent.create",
  indentApprove:   "procurement.indent.approve",
  indentReject:    "procurement.indent.reject",
  vendorCreate:    "procurement.vendor.create",
  vendorEmpanel:   "procurement.vendor.empanel",
  vendorBlacklist: "procurement.vendor.blacklist",
  poCreate:        "procurement.po.create",
  poApprove:       "procurement.po.approve",
  poDispatch:      "procurement.po.dispatch",
  poSubmitApproval: "procurement.po.submit_approval",
  gemOrderCreate:  "procurement.gem_order.create",
  grnCreate:       "procurement.grn.create",
  auctionCreate:   "procurement.auction.create",
  bidSubmit:       "procurement.bid.submit",
  auctionClose:    "procurement.auction.close",
  advanceCreate:   "procurement.advance.create",
  debitNoteCreate: "procurement.debit_note.create",
  // Competitive two-bid tender lifecycle (wave 2)
  tenderCreate:        "procurement.tender.create",
  tenderPublish:       "procurement.tender.publish",
  tenderBidSubmit:     "procurement.tender.bid.submit",
  tenderTechEvaluate:  "procurement.tender.tech_evaluate",
  tenderFinancialOpen: "procurement.tender.financial_open",
  tenderAward:         "procurement.tender.award",
  // EMD / bid-security + performance-security (PBG)
  emdCollect:  "procurement.emd.collect",
  emdForfeit:  "procurement.emd.forfeit",
  emdRefund:   "procurement.emd.refund",
  pbgCollect:  "procurement.pbg.collect",
  pbgForfeit:  "procurement.pbg.forfeit",
  pbgRelease:  "procurement.pbg.release",
  // SVC-041 Annual procurement planning
  planCreate:     "procurement.plan.create",
  planSubmit:     "procurement.plan.submit",
  planApprove:    "procurement.plan.approve",
  planReject:     "procurement.plan.reject",
  planLinkTender: "procurement.plan.link_tender",
  // SVC-046 PO / Work-order amendment + milestone + closure
  poAmendmentRequest: "procurement.po_amendment.request",
  poAmendmentApprove: "procurement.po_amendment.approve",
  poAmendmentReject:  "procurement.po_amendment.reject",
  poMilestoneAdd:     "procurement.po_milestone.add",
  poMilestoneUpdate:  "procurement.po_milestone.update",
  poClose:            "procurement.po.close",
  // SVC-049 Vendor performance
  vendorScorecardRecompute: "procurement.vendor_scorecard.recompute",
  vendorShowCauseIssue:     "procurement.vendor_show_cause.issue",
  vendorShowCauseRespond:   "procurement.vendor_show_cause.respond",
  vendorShowCauseAppeal:    "procurement.vendor_show_cause.appeal",
  vendorShowCauseDecide:    "procurement.vendor_show_cause.decide",
  // SVC-043 Tender document management
  tenderDocAdd:              "procurement.tender_doc.add",
  tenderCorrigendumCreate:   "procurement.tender_corrigendum.create",
  tenderCorrigendumRepublish:"procurement.tender_corrigendum.republish",
  prebidQueryCreate:         "procurement.prebid_query.create",
  prebidQueryAnswer:         "procurement.prebid_query.answer",
  prebidQueryPublish:        "procurement.prebid_query.publish",
  // SVC-050 GeM/CPPP integration reconciliation
  gemExchange:              "procurement.gem_integration.exchange",
  gemReconcile:             "procurement.gem_integration.reconcile",
} as const;

export const EVENTS = {
  tenderRequired:      "procurement.tender.required",
  indentApproved:      "procurement.indent.approved",
  indentRejected:      "procurement.indent.rejected",
  poApproved:          "procurement.po.approved",
  poBudgetExceeded:    "procurement.po.budget_exceeded",
  poVendorBlacklisted: "procurement.po.vendor_blacklisted",
  poApprovalRejected:  "procurement.po.approval_rejected",
  grnAccepted:         "procurement.grn.accepted",
  grnRejected:         "procurement.grn.rejected",
  vendorBlacklisted:   "procurement.vendor.blacklisted",
  auctionClosed:       "procurement.auction.closed",
  // Tender lifecycle events
  tenderPublished:     "procurement.tender.published",
  tenderTechEvaluated: "procurement.tender.tech_evaluated",
  tenderFinancialOpened: "procurement.tender.financial_opened",
  tenderAwarded:       "procurement.tender.awarded",
  // EMD / PBG events
  emdCollected:  "procurement.emd.collected",
  emdForfeited:  "procurement.emd.forfeited",
  emdRefunded:   "procurement.emd.refunded",
  pbgCollected:  "procurement.pbg.collected",
  pbgForfeited:  "procurement.pbg.forfeited",
  pbgReleased:   "procurement.pbg.released",
  // Three-way match (PO ↔ GRN ↔ Invoice) outcome events emitted by finance-service consumer
  threeWayMatchPassed: "procurement.three_way_match.passed",
  threeWayMatchFailed: "procurement.three_way_match.failed",
  // SVC-041 planning
  planApproved:          "procurement.plan.approved",
  // SVC-046 PO/WO
  poAmended:             "procurement.po.amended",
  poClosed:              "procurement.po.closed",
  // SVC-049 vendor performance
  vendorScorecardComputed: "procurement.vendor_scorecard.computed",
  vendorShowCauseIssued:   "procurement.vendor.show_cause_issued",
  vendorDebarmentProposed: "procurement.vendor.debarment_proposed",
  // SVC-043 tender documents
  tenderCorrigendumPublished: "procurement.tender.corrigendum_published",
} as const;

/** Finance accounting (GL) post — paise as strings. */
export const FINANCE_GL_POST = "finance.gl.post";

/** Topics consumed from other services */
export const CONSUMED_EVENTS = {
  legalContractCleared: "legal.contract_review.cleared",
  poFileDecided:        "procurement.po.file_decided",
  // eOffice decision callback for a procurement award eFile
  // (source_ref_type "procurement_award"). See modules/tender/eoffice-consumer.ts.
  awardFileDecided:     "procurement.award.file_decided",
  /**
   * Owner: meeting-service. Fires when a board/committee records a procurement
   * decision (Req 22.1). payload: { decisionId, meetingId, text, authority?, effectiveDate? }.
   * Action: open a PENDING REVIEW indent-intake item (no auto-indent; GFR maker-checker).
   */
  meetingDecisionProcurement: "meeting.decision.procurement",
  /**
   * Owner: contract-service. Fires when a contract is terminated (breach/default).
   * SVC-049: the vendor-performance scorecard consumer records this as an SLA breach
   * performance event for the counterparty vendor, feeding the objective rating.
   */
  contractTerminated: "contract.contract.terminated",
} as const;

export const SERVICE = "procurement";
