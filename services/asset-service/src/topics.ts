export const COMMANDS = {
  assetCreate:          "asset.asset.create",
  assetTransfer:        "asset.asset.transfer",
  assetDispose:         "asset.asset.dispose",
  depSchedule:          "asset.dep.schedule",
  depRun:               "asset.dep.run",
  maintenancePlan:      "asset.maintenance.plan",
  workOrderCreate:      "asset.work_order.create",
  workOrderComplete:    "asset.work_order.complete",
  insurancePolicyCreate:"asset.insurance.policy.create",
  insuranceClaimCreate: "asset.insurance.claim.create",
} as const;

export const EVENTS = {
  assetCreated:    "asset.asset.created",
  assetTransferred:"asset.asset.transferred",
  assetDisposed:   "asset.disposed",
  depPosted:       "asset.dep.posted",
} as const;

export const CONSUMED = {
  grnAccepted: "procurement.grn.accepted",
  assetDisposeApproved: "asset.dispose.approve",
} as const;

export const SERVICE = "asset";
