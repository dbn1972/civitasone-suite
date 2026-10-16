import type { MunicipalServiceConfig } from "./types";

export const crematoriumService: MunicipalServiceConfig = {
  serviceKey: "crematorium",
  moduleKey: "crematorium",
  label: "Crematorium",
  shortLabel: "Crematorium",
  icon: "🕯️",
  description: "Crematorium slot bookings and facility records.",
  listPath: "/api/v1/crematorium/bookings",
  resourceLabel: "Bookings",
  titleIsPerson: true,
  titleFields: ["deceasedName", "applicantName"],
  numberFields: ["bookingNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: crematorium/bookings/domain.ts.
  statusVocabulary: ["requested", "confirmed", "completed", "cancelled"],
  citizenServiceKey: "crematorium-booking",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // crematorium-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["bookingNumber", "applicantName", "applicantRelation", "deceasedName", "deceasedAge", "deceasedGender", "requestedDate", "requestedSlot", "slotNumber", "feePaid", "paymentRef"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "bookingNumber", "deceasedName", "applicantName"],
  sec5: true,
};
