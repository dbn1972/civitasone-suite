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

export const TRADE_CATEGORIES = [
  "retail",
  "wholesale",
  "manufacturing",
  "food_beverage",
  "services",
  "hospitality",
  "healthcare",
  "education",
  "construction",
  "transport",
  "other",
] as const;

export interface FeeCalculationInput {
  tradeCategory: string;
  areaInSqft?: number | undefined;
  employeeCount?: number | undefined;
}

export function calculateFeeMinor(input: FeeCalculationInput): bigint {
  let baseFee = 100000n; // Rs 1000 default
  if (input.tradeCategory === "manufacturing" || input.tradeCategory === "construction") {
    baseFee = 500000n;
  } else if (input.tradeCategory === "wholesale" || input.tradeCategory === "hospitality") {
    baseFee = 250000n;
  }
  if (input.employeeCount && input.employeeCount > 10) {
    baseFee += BigInt(input.employeeCount - 10) * 2000n;
  }
  if (input.areaInSqft && input.areaInSqft > 500) {
    baseFee += BigInt(Math.floor((input.areaInSqft - 500) / 100)) * 5000n;
  }
  return baseFee;
}

export function generateApplicationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `TRADE/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
