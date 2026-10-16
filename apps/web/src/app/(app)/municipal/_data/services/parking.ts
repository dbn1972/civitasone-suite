import type { MunicipalServiceConfig } from "./types";

export const parkingService: MunicipalServiceConfig = {
  serviceKey: "parking",
  moduleKey: "parking",
  label: "Municipal Parking",
  shortLabel: "Parking",
  icon: "🅿️",
  description: "Parking bookings, passes and enforcement.",
  listPath: "/api/v1/parking/bookings",
  resourceLabel: "Bookings",
  titleFields: ["vehicleNumber", "vehicleType"],
  numberFields: ["bookingNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: parking/bookings/domain.ts.
  statusVocabulary: ["booked", "active", "completed", "cancelled"],
  citizenServiceKey: "parking-pass",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // parking-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["bookingNumber", "vehicleNumber", "vehicleType", "entryTime", "exitTime", "durationMinutes", "paymentRef", "spaceNumber"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "bookingNumber", "vehicleNumber", "vehicleType"],
  sec5: true,
};
