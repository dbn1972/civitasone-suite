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
  citizenServiceKey: "crematorium-booking",
  sec5: true,
};
