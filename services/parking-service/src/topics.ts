export const COMMANDS = {
  // facilities
  createFacility: "parking.facility.create",
  updateFacility: "parking.facility.update",

  // passes
  createPass: "parking.pass.create",
  cancelPass: "parking.pass.cancel",

  // bookings
  createBooking: "parking.booking.create",
  recordEntry: "parking.booking.entry",
  recordExit: "parking.booking.exit",
  cancelBooking: "parking.booking.cancel",

  // enforcement
  issueViolation: "parking.violation.issue",
  payViolation: "parking.violation.pay",
  contestViolation: "parking.violation.contest",
} as const;

export const EVENTS = {
  // facilities
  facilityCreated: "parking.facility.created",
  facilityUpdated: "parking.facility.updated",

  // passes
  passCreated: "parking.pass.created",
  passCancelled: "parking.pass.cancelled",

  // bookings
  bookingCreated: "parking.booking.created",
  entryRecorded: "parking.booking.entry_recorded",
  exitRecorded: "parking.booking.exit_recorded",
  bookingCancelled: "parking.booking.cancelled",

  // enforcement
  violationIssued: "parking.violation.issued",
  violationPaid: "parking.violation.paid",
  violationContested: "parking.violation.contested",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "parking";
