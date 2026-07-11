/** Topic + event names owned by visitor-service. {service}.{entity}.{action} */

export const COMMANDS = {
  // Visit Request
  visitRequestCreate:          "visitor.visit_request.create",
  visitRequestApprove:         "visitor.visit_request.approve",
  visitRequestReject:          "visitor.visit_request.reject",
  visitRequestCancel:          "visitor.visit_request.cancel",
  visitRequestAutoReject:      "visitor.visit_request.auto_reject",

  // Digital Pass
  passGenerate:                "visitor.pass.generate",
  passRevoke:                  "visitor.pass.revoke",
  passReplace:                 "visitor.pass.replace",

  // Check-in / Check-out
  checkInRecord:               "visitor.check_in.record",
  checkOutRecord:              "visitor.check_out.record",
  overstayDetect:              "visitor.overstay.detect",

  // Identity
  digilockerVerify:            "visitor.identity.digilocker_verify",
  aadhaarFaceMatch:            "visitor.identity.aadhaar_face_match",

  // Blacklist / Watchlist
  blacklistAdd:                "visitor.blacklist.add",
  blacklistApprove:            "visitor.blacklist.approve",
  watchlistAdd:                "visitor.watchlist.add",

  // Material / Vehicle
  materialPassCreate:          "visitor.material_pass.create",
  materialPassReconcile:       "visitor.material_pass.reconcile",
  vehiclePassCreate:           "visitor.vehicle_pass.create",
  parkingSlotRelease:          "visitor.parking.release",

  // Group Visit
  groupVisitCreate:            "visitor.group_visit.create",
  groupBulkCheckIn:            "visitor.group_visit.bulk_check_in",

  // Recurring Pass
  recurringPassCreate:         "visitor.recurring_pass.create",
  recurringPassSuspend:        "visitor.recurring_pass.suspend",
  recurringPassRevoke:         "visitor.recurring_pass.revoke",

  // Evacuation
  evacuationDeclare:           "visitor.evacuation.declare",
  evacuationMarkSafe:          "visitor.evacuation.mark_safe",

  // Analytics
  analyticsCompute:            "visitor.analytics.compute",

  // Device Registry
  deviceRegister:              "visitor.device.register",
  deviceActivate:              "visitor.device.activate",
  deviceSuspend:               "visitor.device.suspend",
  deviceDeregister:            "visitor.device.deregister",
  deviceRotateCredential:      "visitor.device.rotate_credential",
  deviceConfigPush:            "visitor.device.config_push",
  deviceBulkConfigPush:        "visitor.device.bulk_config_push",
  deviceFirmwareSchedule:      "visitor.device.firmware_schedule",

  // Badge Print
  printJobCreate:              "visitor.print_job.create",
  printJobAcknowledge:         "visitor.print_job.acknowledge",
  printJobFail:                "visitor.print_job.fail",
  printJobRetry:               "visitor.print_job.retry",
  printJobRequeue:             "visitor.print_job.requeue",
  badgeTemplateCreate:         "visitor.badge_template.create",
  badgeTemplateUpdate:         "visitor.badge_template.update",

  // Document Scan
  scanProcess:                 "visitor.scan.process",
  scanOcrComplete:             "visitor.scan.ocr_complete",

  // Turnstile Control
  turnstileOpen:               "visitor.turnstile.open",
  turnstileClose:              "visitor.turnstile.close",
  emergencyUnlock:             "visitor.emergency.unlock",
  emergencyRestore:            "visitor.emergency.restore",
  passageRecord:               "visitor.passage.record",
  offlineSync:                 "visitor.device.offline_sync",

  // Config/metadata keystone — nothing hardcoded (tenant-scoped policy engine)
  setConfig:                   "visitor.config.set",
  deactivateConfig:            "visitor.config.deactivate",
} as const;

export const EVENTS = {
  // Visit Request lifecycle
  visitRequestCreated:         "visitor.visit_request.created",
  visitRequestApproved:        "visitor.visit_request.approved",
  visitRequestRejected:        "visitor.visit_request.rejected",
  visitRequestCancelled:       "visitor.visit_request.cancelled",
  visitRequestAutoRejected:    "visitor.visit_request.auto_rejected",
  visitRequestBlocked:         "visitor.visit_request.blocked",

  // Pass lifecycle
  passGenerated:               "visitor.pass.generated",
  passRevoked:                 "visitor.pass.revoked",
  passReplaced:                "visitor.pass.replaced",
  passExpired:                 "visitor.pass.expired",

  // Check-in / Check-out
  visitorCheckedIn:            "visitor.checked_in",
  visitorCheckedOut:           "visitor.checked_out",
  overstayAlerted:             "visitor.overstay.alerted",
  noShowDetected:               "visitor.no_show.detected",

  // Identity
  identityVerified:            "visitor.identity.verified",
  identityFailed:              "visitor.identity.failed",

  // Security
  blacklistMatched:            "visitor.blacklist.matched",
  watchlistMatched:            "visitor.watchlist.matched",
  securityIncidentCreated:     "visitor.security_incident.created",

  // Group Visit
  groupVisitCreated:           "visitor.group_visit.created",

  // Evacuation
  evacuationDeclared:          "visitor.evacuation.declared",
  evacuationCompleted:         "visitor.evacuation.completed",

  // Capacity
  capacityThresholdReached:    "visitor.capacity.threshold_reached",

  // Device Registry Events
  deviceRegistered:            "visitor.device.registered",
  deviceActivated:             "visitor.device.activated",
  deviceSuspended:             "visitor.device.suspended",
  deviceDeregistered:          "visitor.device.deregistered",
  deviceCredentialRotated:     "visitor.device.credential_rotated",
  deviceHealthOnline:          "visitor.device.health.online",
  deviceHealthOffline:         "visitor.device.health.offline",
  deviceFirmwareOutdated:      "visitor.device.firmware.outdated",
  deviceConfigDelivered:       "visitor.device.config.delivered",
  deviceConfigFailed:          "visitor.device.config.delivery_failed",
  deviceSyncCompleted:         "visitor.device.sync.completed",

  // Badge Print Events
  printJobCreated:             "visitor.print_job.created",
  printJobCompleted:           "visitor.print_job.completed",
  printJobFailed:              "visitor.print_job.failed",
  badgeTemplateCreated:        "visitor.badge_template.created",
  badgeTemplateUpdated:        "visitor.badge_template.updated",

  // Document Scan Events
  scanCompleted:               "visitor.scan.completed",
  scanOcrLowConfidence:        "visitor.scan.ocr_low_confidence",
  scanBlacklistMatch:          "visitor.scan.blacklist_match",

  // Turnstile Control Events
  passageConfirmed:            "visitor.passage.confirmed",
  passageAbandoned:            "visitor.passage.abandoned",
  tailgatingDetected:          "visitor.tailgating.detected",
  antiPassbackViolation:       "visitor.anti_passback.violation",
  emergencyUnlockTriggered:    "visitor.emergency.unlock.triggered",
  emergencyRestored:           "visitor.emergency.restored",

  // Config/metadata keystone lifecycle
  configSet:                   "visitor.config.set_done",
  configDeactivated:           "visitor.config.deactivated",
} as const;

export const CONSUMED_EVENTS = {
  workflowTaskCompleted:       "workflow.task.completed",
  workflowInstanceRejected:    "workflow.instance.rejected",
  evacuationDeclared:          "visitor.evacuation.declared",  // triggers emergency unlock
} as const;

export const SERVICE = "visitor";
