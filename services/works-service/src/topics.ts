/** Topic + event names owned by works-service. {service}.{entity}.{action} */

export const COMMANDS = {
  // Proposal
  proposalCreate:              "works.proposal.create",
  proposalUpdate:              "works.proposal.update",
  proposalDaoFinalize:         "works.proposal.dao_finalize",
  proposalSplit:               "works.proposal.split",
  proposalMapOffice:           "works.proposal.map_office",
  proposalMapCoa:              "works.proposal.map_coa",

  // Approval
  aaCreate:                    "works.aa.create",
  aaFinalize:                  "works.aa.finalize",
  tsCreate:                    "works.ts.create",
  tsFinalize:                  "works.ts.finalize",

  // BoQ
  boqAddItem:                  "works.boq.add_item",
  boqUpdateItem:               "works.boq.update_item",
  boqDeleteItem:               "works.boq.delete_item",
  boqRecapitulate:             "works.boq.recapitulate",

  // Tender
  preTenderCreate:             "works.pre_tender.create",
  preTenderFinalize:           "works.pre_tender.finalize",
  tenderCreate:                "works.tender.create",
  quotationAdd:                "works.quotation.add",
  awardCreate:                 "works.award.create",
  awardDaoFinalize:            "works.award.dao_finalize",
  awardDoFinalize:             "works.award.do_finalize",

  // Execution
  scopeAdd:                    "works.scope.add",
  progressRecord:              "works.progress.record",
  photoUpload:                 "works.photo.upload",
  issueCreate:                 "works.issue.create",
  issueClose:                  "works.issue.close",
  physicalComplete:            "works.physical.complete",
  workClose:                   "works.work.close",

  // Billing
  mbIssue:                     "works.mb.issue",
  measurementRecord:           "works.measurement.record",
  mbFinalize:                  "works.mb.finalize",
  billCreate:                  "works.bill.create",
  billFinalize:                "works.bill.finalize",
  accountCompile:              "works.account.compile",
} as const;

export const EVENTS = {
  // Proposal
  proposalCreated:             "works.proposal.created",
  proposalUpdated:             "works.proposal.updated",
  proposalDaoFinalized:        "works.proposal.dao_finalized",
  proposalSplit:               "works.proposal.split_created",
  proposalCoaMapped:           "works.proposal.coa_mapped",
  proposalOfficeMapped:        "works.proposal.office_mapped",

  // Approval
  aaCreated:                   "works.aa.created",
  aaFinalized:                 "works.aa.finalized",
  tsCreated:                   "works.ts.created",
  tsFinalized:                 "works.ts.finalized",

  // BoQ
  boqItemAdded:                "works.boq.item_added",
  boqItemUpdated:              "works.boq.item_updated",
  boqItemDeleted:              "works.boq.item_deleted",
  boqRecapitulated:            "works.boq.recapitulated",

  // Tender
  preTenderCreated:            "works.pre_tender.created",
  tenderCreated:               "works.tender.created",
  awardCreated:                "works.award.created",
  quotationAdded:              "works.quotation.added",
  awardDaoFinalized:           "works.award.dao_finalized",
  awardDoFinalized:            "works.award.do_finalized",
  awardFinalized:              "works.award.finalized",

  // Execution
  scopeAdded:                  "works.scope.added",
  progressRecorded:            "works.progress.recorded",
  photoUploaded:               "works.photo.uploaded",
  issueCreated:                "works.issue.created",
  workClosed:                  "works.work.closed",
  physicalCompleted:           "works.physical.completed",
  // Cross-service: emitted on a completion-type closure so asset-service
  // registers the newly-created public asset (closes the handover loop).
  assetHandover:               "works.asset.handover",

  // Billing
  mbIssued:                    "works.mb.issued",
  measurementRecorded:         "works.measurement.recorded",
  mbFinalized:                 "works.mb.finalized",
  billCreated:                 "works.bill.created",
  billFinalized:               "works.bill.finalized",
  accountCompiled:             "works.account.compiled",
} as const;

export const CONSUMED_EVENTS = {
  workflowTaskCompleted:       "workflow.task.completed",
} as const;

export const SERVICE = "works";
