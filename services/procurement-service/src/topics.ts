export const COMMANDS = {
  indentCreate:    "procurement.indent.create",
  indentApprove:   "procurement.indent.approve",
  vendorCreate:    "procurement.vendor.create",
  vendorEmpanel:   "procurement.vendor.empanel",
  vendorBlacklist: "procurement.vendor.blacklist",
  poCreate:        "procurement.po.create",
  poApprove:       "procurement.po.approve",
  poDispatch:      "procurement.po.dispatch",
  gemOrderCreate:  "procurement.gem_order.create",
  grnCreate:       "procurement.grn.create",
  auctionCreate:   "procurement.auction.create",
  bidSubmit:       "procurement.bid.submit",
  auctionClose:    "procurement.auction.close",
  advanceCreate:   "procurement.advance.create",
  debitNoteCreate: "procurement.debit_note.create",
} as const;

export const EVENTS = {
  tenderRequired:      "procurement.tender.required",
  indentApproved:      "procurement.indent.approved",
  poApproved:          "procurement.po.approved",
  poBudgetExceeded:    "procurement.po.budget_exceeded",
  poVendorBlacklisted: "procurement.po.vendor_blacklisted",
  grnAccepted:         "procurement.grn.accepted",
  grnRejected:         "procurement.grn.rejected",
  vendorBlacklisted:   "procurement.vendor.blacklisted",
  auctionClosed:       "procurement.auction.closed",
} as const;

/** Topics consumed from other services */
export const CONSUMED_EVENTS = {
  legalContractCleared: "legal.contract_review.cleared",
} as const;

export const SERVICE = "procurement";
