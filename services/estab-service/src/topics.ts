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
} as const;

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
