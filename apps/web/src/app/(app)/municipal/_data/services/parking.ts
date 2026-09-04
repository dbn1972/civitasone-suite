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
  citizenServiceKey: "parking-pass",
  sec5: true,
};
