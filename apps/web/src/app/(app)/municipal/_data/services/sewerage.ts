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
  citizenServiceKey: "desludging-booking",
  sec5: true,
};
