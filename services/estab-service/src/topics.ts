import { MODULE_CALLBACK_TOPICS as SDK_CALLBACK_TOPICS } from "@civitasone/eoffice-sdk";

export const COMMANDS = {
  fileCreate:           "estab.file.create",
  fileMove:             "estab.file.move",
  fileClose:            "estab.file.close",
  notingAdd:            "estab.noting.add",
  notingSubmit:         "estab.noting.submit",
  inwardOpenFile:       "estab.inward.open_file",
  dispatchCreate:       "estab.dispatch.create",
  inwardRegister:       "estab.inward.register",
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
