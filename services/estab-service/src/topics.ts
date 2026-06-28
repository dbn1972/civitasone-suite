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
} as const;

/**
 * Decision callback topics — emitted back to source modules when an eFile
 * raised by them is approved/rejected. Keyed by source_ref_type.
 */
export const MODULE_CALLBACK_TOPICS: Record<string, string> = {
  finance_sanction:        "finance.sanction.file_decided",
  finance_payment:         "finance.payment.file_decided",
  finance_reappropriation: "finance.reappropriation.file_decided",
  procurement_award:       "procurement.award.file_decided",
  procurement_po:          "procurement.po.file_decided",
  hr_promotion:            "hrms.promotion.file_decided",
  hr_transfer:             "hrms.transfer.file_decided",
  hr_disciplinary:         "hrms.disciplinary.file_decided",
  hr_leave_special:        "hrms.leave_special.file_decided",
  hr_recruitment:          "hrms.recruitment.file_decided",
  grant_scheme:            "grant.scheme.file_decided",
  grant_disbursement:      "grant.disbursement.file_decided",
  asset_disposal:          "asset.disposal.file_decided",
  legal_opinion:           "legal.opinion.file_decided",
  contract_award:          "contract.award.file_decided",
};

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
