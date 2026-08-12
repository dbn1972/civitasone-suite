export const COMMANDS = {
  // facilities
  createFacility: "crematorium.facility.create",
  updateFacility: "crematorium.facility.update",

  // bookings
  requestBooking: "crematorium.booking.request",
  confirmBooking: "crematorium.booking.confirm",
  completeBooking: "crematorium.booking.complete",
  cancelBooking: "crematorium.booking.cancel",

  // records
  recordService: "crematorium.record.create",
} as const;

export const EVENTS = {
  // facilities
  facilityCreated: "crematorium.facility.created",
  facilityUpdated: "crematorium.facility.updated",

  // bookings
  bookingRequested: "crematorium.booking.requested",
  bookingConfirmed: "crematorium.booking.confirmed",
  bookingCompleted: "crematorium.booking.completed",
  bookingCancelled: "crematorium.booking.cancelled",

  // records
  serviceRecorded: "crematorium.record.created",
} as const;

export const CONSUMED_EVENTS = {} as const;

export const SERVICE = "crematorium";
