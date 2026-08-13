export const REGISTRATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "zone_allocated",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, RegistrationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["zone_allocated", "approved", "rejected"],
  zone_allocated: ["approved", "rejected"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: string, to: RegistrationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const VENDOR_CATEGORIES = ["food", "non_food", "service"] as const;

export interface FeeCalculationInput {
  category: string;
  zone?: string | undefined;
}

export function calculateFeeMinor(input: FeeCalculationInput): bigint {
  let baseFee = 50000n; // Rs 500 default
  if (input.category === "food") {
    baseFee = 100000n; // Rs 1000
  } else if (input.category === "service") {
    baseFee = 75000n; // Rs 750
  }
  return baseFee;
}

export function generateRegistrationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `VEND/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
