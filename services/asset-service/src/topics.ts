export const COMMANDS = {
  assetCreate:          "asset.asset.create",
  assetTagBarcode:      "asset.asset.tag_barcode",
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
  // Fleet + fleet-devices (facade closure)
  fleetCreate:               "asset.fleet.create",
  fleetGpsUpdate:            "asset.fleet.gps_update",
  fleetScheduleMaintenance:  "asset.fleet.schedule_maintenance",
  fleetDeviceRegister:       "asset.fleet_device.register",
  fleetDeviceTelemetry:      "asset.fleet_device.telemetry",
  f3RouteWrite:              "asset.f3.route_write",
  verificationCreate:        "asset.verification.create",
  verificationItemAdd:       "asset.verification.item.add",
  verificationSubmit:        "asset.verification.submit",
  verificationApprove:       "asset.verification.approve",
  writeoffRequest:           "asset.writeoff.request",
  writeoffApprove:           "asset.writeoff.approve",
  // Water connections
  waterApplicationCreate:    "asset.water.application.create",
  waterApplicationSubmit:    "asset.water.application.submit",
  waterFeasibilityRecord:    "asset.water.feasibility.record",
  waterApplicationApprove:   "asset.water.application.approve",
  waterApplicationReject:    "asset.water.application.reject",
  waterConnectionInstall:    "asset.water.connection.install",
  waterConnectionActivate:   "asset.water.connection.activate",
  // Water metering
  waterMeterReadingRecord:   "asset.water.meter_reading.record",
  waterBillGenerate:         "asset.water.bill.generate",
  waterServiceRequestCreate: "asset.water.service_request.create",
  waterServiceRequestResolve:"asset.water.service_request.resolve",
  // Water tanker
  waterTankerBookingCreate:  "asset.water_tanker.booking.create",
  waterTankerBookingSchedule:"asset.water_tanker.booking.schedule",
  waterTankerBookingDispatch:"asset.water_tanker.booking.dispatch",
  waterTankerBookingDeliver: "asset.water_tanker.booking.deliver",
  waterTankerBookingCancel:  "asset.water_tanker.booking.cancel",
  // Streetlight
  streetlightCreate:         "asset.streetlight.create",
  streetlightStatusUpdate:   "asset.streetlight.status.update",
  streetlightFaultReport:    "asset.streetlight.fault.report",
  streetlightFaultAssign:    "asset.streetlight.fault.assign",
  streetlightFaultResolve:   "asset.streetlight.fault.resolve",
  streetlightRequestCreate:  "asset.streetlight.request.create",
  streetlightRequestSurvey:  "asset.streetlight.request.survey",
  streetlightRequestApprove: "asset.streetlight.request.approve",
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
