import { MODULE_CALLBACK_TOPICS as SDK_CALLBACK_TOPICS } from "@civitasone/eoffice-sdk";

export const COMMANDS = {
  fileCreate:           "estab.file.create",
  fileMove:             "estab.file.move",
  fileClose:            "estab.file.close",
  fileRecall:           "estab.file.recall",
  fileReopen:           "estab.file.reopen",
  // file-type taxonomy (R2)
  fileOpenVolume:       "estab.file.open_volume",
  fileOpenPart:         "estab.file.open_part",
  fileLink:             "estab.file.link",
  fileSetType:          "estab.file.set_type",
  notingAdd:            "estab.noting.add",
  notingSubmit:         "estab.noting.submit",
  notingSign:           "estab.noting.sign",
  inwardOpenFile:       "estab.inward.open_file",
  dispatchCreate:       "estab.dispatch.create",
  inwardRegister:       "estab.inward.register",
  inwardAttach:         "estab.inward.attach",
  inwardDetach:         "estab.inward.detach",
  dispatchDelivery:     "estab.dispatch.delivery",
  fileAttachmentAdd:    "estab.file.attachment.add",
  committeeCreate:      "estab.committee.create",
  meetingCreate:        "estab.meeting.create",
  resolutionCreate:     "estab.resolution.create",
  meetingMinutes:       "estab.meeting.minutes",
  attendanceRecord:     "estab.attendance.record",
  vehicleCreate:        "estab.vehicle.create",
  vehicleBook:          "estab.vehicle.book",
  vehicleReturn:        "estab.vehicle.return",
  guesthouseCreate:     "estab.guesthouse.create",
  roomBook:             "estab.room.book",
  roomCheckin:          "estab.room.checkin",
  roomCheckout:         "estab.room.checkout",
  libraryAdd:           "estab.library.add",
  libraryIssue:         "estab.library.issue",
  courtCaseCreate:      "estab.court_case.create",
  courtCaseNextDate:    "estab.court_case.next_date",
  rtiCreate:            "estab.rti.create",
  rtiRespond:           "estab.rti.respond",
  fileFromModule:       "estab.file.from_module",
  approvalRuleCreate:   "estab.approval_rule.create",
  approvalRuleUpdate:   "estab.approval_rule.update",
  dfaCreate:            "estab.dfa.create",
  dfaUpdate:            "estab.dfa.update",
  dfaSubmit:            "estab.dfa.submit",
  dfaApprove:           "estab.dfa.approve",
  dfaReturn:            "estab.dfa.return",
  dfaSign:              "estab.dfa.sign",
  dfaDispatch:          "estab.dfa.dispatch",
  addressCreate:        "estab.address.create",
  handoverCreate:       "estab.handover.create",
  migrationRegister:    "estab.migration.register",
  migrationLink:        "estab.migration.link",
  operatorEnrol:        "estab.operator.enrol",
  operatorUpdate:       "estab.operator.update",
  // org hierarchy (R1)
  orgUnitCreate:        "estab.org_unit.create",
  orgUnitUpdate:        "estab.org_unit.update",
  // structured referencing (R7)
  referenceAdd:         "estab.reference.add",
  referenceRemove:      "estab.reference.remove",
  // correspondence (yellow side) + PUC
  correspondenceAdd:    "estab.correspondence.add",
  pucMark:              "estab.file.puc.mark",
  pucUnmark:            "estab.file.puc.unmark",
  // records management / retention / weed-out
  assignCategory:       "estab.record.assign_category",
  recordDisposal:       "estab.record.record_disposal",
  weedoutPropose:       "estab.weedout.propose",
  weedoutApprove:       "estab.weedout.approve",
  weedoutReject:        "estab.weedout.reject",
  weedoutDestroy:       "estab.weedout.destroy",
} as const;

/**
 * Decision callback topics — emitted back to source modules when an eFile
 * raised by them is approved/rejected. Keyed by source_ref_type.
 *
 * Sourced from @civitasone/eoffice-sdk (single source of truth) and widened to
 * Record<string, string> for runtime string-keyed lookup in the consumer.
 */
export const MODULE_CALLBACK_TOPICS: Record<string, string> = SDK_CALLBACK_TOPICS;

export const EVENTS = {
  fileCreated:          "estab.file.created",
  fileMoved:            "estab.file.moved",
  rtiCreated:           "estab.rti.created",
  rtiResponded:         "estab.rti.responded",
  rtiOverdue:           "estab.rti.overdue",
  resolutionCreated:    "estab.resolution.created",
  courtCaseDateSet:     "estab.court_case.date_set",
  roomConflict:         "estab.room.conflict",
  vehicleConflict:      "estab.vehicle.conflict",
} as const;

/** Topics consumed from other services */
export const CONSUMED_EVENTS = {
  citizenRtiFiled: "citizen.rti.filed",
  fileApprove: "estab.file.approve",
  fileReject: "estab.file.reject",
} as const;

export const SERVICE = "estab";
