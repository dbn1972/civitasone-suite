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
  sec5: true,
};
