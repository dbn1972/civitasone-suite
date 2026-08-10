export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_scrutiny",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_scrutiny", "withdrawn"],
  under_scrutiny: ["approved", "rejected"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: string, to: ApplicationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export interface FeeCalculationInput {
  plotArea?: number | undefined;
  builtUpArea?: number | undefined;
  proposedFloors?: number | undefined;
}

export function calculateFeeMinor(input: FeeCalculationInput): bigint {
  let baseFee = 500000n; // Rs 5000 default
  if (input.builtUpArea && input.builtUpArea > 200) {
    baseFee += BigInt(Math.floor((input.builtUpArea - 200) / 50)) * 100000n;
  }
  if (input.proposedFloors && input.proposedFloors > 2) {
    baseFee += BigInt(input.proposedFloors - 2) * 200000n;
  }
  return baseFee;
}

export function generateApplicationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `BLDG/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function computeFAR(builtUpArea: number, plotArea: number): number {
  if (plotArea <= 0) return 0;
  return Math.round((builtUpArea / plotArea) * 1000) / 1000;
}
