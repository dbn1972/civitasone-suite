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
  sec5: true,
};
