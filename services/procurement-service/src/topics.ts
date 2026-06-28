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
} as const;

/** Finance accounting (GL) post — paise as strings. */
export const FINANCE_GL_POST = "finance.gl.post";

/** Topics consumed from other services */
export const CONSUMED_EVENTS = {
  legalContractCleared: "legal.contract_review.cleared",
  poFileDecided:        "procurement.po.file_decided",
} as const;

export const SERVICE = "procurement";
