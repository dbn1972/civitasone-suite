export const COMMANDS = {
  assetCreate:          "asset.asset.create",
  assetTransfer:        "asset.asset.transfer",
  assetDispose:         "asset.asset.dispose",
  disposalSubmitApproval: "asset.disposal.submit_approval",
  depSchedule:          "asset.dep.schedule",
  depRun:               "asset.dep.run",
  maintenancePlan:      "asset.maintenance.plan",
  workOrderCreate:      "asset.work_order.create",
  workOrderComplete:    "asset.work_order.complete",
  meterReadingRecord:   "asset.meter_reading.record",
  impairmentTestRun:    "asset.impairment_test.run",
  insurancePolicyCreate:"asset.insurance.policy.create",
  insuranceClaimCreate: "asset.insurance.claim.create",
  // Condemnation/disposal/auction (SVC-060)
  condemnationSurveyCreate:  "asset.condemnation.survey.create",
  condemnationSurveySubmit:  "asset.condemnation.survey.submit",
  condemnationRecommend:     "asset.condemnation.recommend",
  condemnationApprove:       "asset.condemnation.approve",
  auctionCreate:             "asset.auction.create",
  auctionComplete:           "asset.auction.complete",
} as const;

export const EVENTS = {
  assetCreated:    "asset.asset.created",
  assetTransferred:"asset.asset.transferred",
  assetDisposed:   "asset.disposed",
  depPosted:       "asset.dep.posted",
  meterReadingRecorded:   "asset.meter_reading.recorded",
  meterThresholdBreached: "asset.meter_reading.threshold_breached",
  impairmentTestCompleted:"asset.impairment_test.completed",
} as const;

export const CONSUMED = {
  grnAccepted: "procurement.grn.accepted",
  assetDisposeApproved: "asset.dispose.approve",
} as const;

/** Topics consumed from other services (cross-service stitching). */
export const CONSUMED_EVENTS = {
  // eOffice (estab-service) emits the asset disposal decision back on this topic.
  disposalFileDecided: "asset.disposal.file_decided",
  // works-service emits this on a completion-type work closure so the newly
  // built public asset is registered here (closes the asset-handover loop).
  worksAssetHandover: "works.asset.handover",
} as const;

export const SERVICE = "asset";
