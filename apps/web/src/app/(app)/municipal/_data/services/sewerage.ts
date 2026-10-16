import type { MunicipalServiceConfig } from "./types";

export const sewerageService: MunicipalServiceConfig = {
  serviceKey: "sewerage",
  moduleKey: "sewerage",
  label: "Sewerage & Desludging",
  shortLabel: "Sewerage",
  icon: "🚽",
  description: "Septic tank desludging bookings and billing.",
  listPath: "/api/v1/sewerage/desludging",
  resourceLabel: "Desludging bookings",
  titleFields: ["address", "requestedSlot"],
  numberFields: ["bookingNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: sewerage/desludging/domain.ts BookingStatus.
  statusVocabulary: ["requested", "scheduled", "dispatched", "completed", "cancelled"],
  citizenServiceKey: "desludging-booking",
  // W2 PQ-C: service-specific record fields the officer detail panel may show (allow-list, from the
  // sewerage-service drizzle schema). Blobs (documents/photos), actor UUIDs and raw document numbers stay out.
  displayFields: ["bookingNumber", "address", "tankCapacityLitres", "requestedDate", "requestedSlot", "feePaid"],
  // GAP-MUNICIPAL-SERVICEKEY-APPLICATIONS-DETAIL-03: status leads, then
  // the service's natural reference + subject fields, rest alphabetical.
  fieldOrder: ["status", "bookingNumber", "address"],
  sec5: true,
};
