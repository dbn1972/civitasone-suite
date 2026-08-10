export const SERVICE_TYPES = ["cremation", "burial", "electric_cremation"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
