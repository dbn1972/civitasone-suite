export const REGISTRATION_STATUSES = ["active", "expired", "transferred", "deceased"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

export function generateRegistrationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `ANML-REG/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function calculateRegistrationFee(animalType: string): bigint {
  if (animalType === "dog") return 50000n;  // Rs 500
  if (animalType === "cat") return 30000n;  // Rs 300
  return 25000n; // Rs 250 default
}
