export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_scrutiny",
  "inspecting",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_scrutiny", "withdrawn"],
  under_scrutiny: ["inspecting", "approved", "rejected"],
  inspecting: ["approved", "rejected"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: string, to: ApplicationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const ESTABLISHMENT_TYPES = [
  "shop",
  "hotel",
  "restaurant",
  "commercial_establishment",
  "factory",
  "warehouse",
  "office",
  "other",
] as const;

export const OWNER_TYPES = ["individual", "partnership", "company", "trust", "society", "huf"] as const;

export const ACTIVITY_CATEGORIES = [
  "retail",
  "food_beverage",
  "services",
  "manufacturing",
  "wholesale",
  "hospitality",
  "healthcare",
  "education",
  "other",
] as const;

export interface FeeCalculationInput {
  establishmentType: string;
  activityCategory: string;
  employeeCount?: number | undefined;
  areaSqft?: number | undefined;
}

export function calculateFeeMinor(input: FeeCalculationInput): bigint {
  let baseFee = 100000n; // Rs 1000 default
  if (input.establishmentType === "hotel" || input.establishmentType === "restaurant") {
    baseFee = 250000n;
  } else if (input.establishmentType === "factory" || input.establishmentType === "warehouse") {
    baseFee = 500000n;
  }
  if (input.employeeCount && input.employeeCount > 20) {
    baseFee += BigInt(input.employeeCount - 20) * 1000n;
  }
  if (input.areaSqft && input.areaSqft > 500) {
    baseFee += BigInt(Math.floor((input.areaSqft - 500) / 100)) * 5000n;
  }
  return baseFee;
}

export function generateApplicationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `SHOP/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
