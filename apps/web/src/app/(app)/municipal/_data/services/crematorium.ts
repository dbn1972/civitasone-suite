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
  titleFields: ["deceasedName", "applicantName"],
  numberFields: ["bookingNumber"],
  // GAP2-MUNICIPAL-APPLICATIONS-STATUS-01: crematorium/bookings/domain.ts.
  statusVocabulary: ["requested", "confirmed", "completed", "cancelled"],
  citizenServiceKey: "crematorium-booking",
  sec5: true,
};
