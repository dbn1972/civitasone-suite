export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

export function canTransition(from: string, to: ApplicationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const PURPOSES = [
  "water_pipe",
  "sewer_pipe",
  "gas_pipe",
  "telecom",
  "electricity",
  "other",
] as const;

export const ROAD_TYPES = ["arterial", "sub_arterial", "collector", "local"] as const;

export interface FeeCalculationInput {
  roadType: string;
  cuttingLength: number;
  cuttingWidth: number;
}

export function calculateFeeMinor(input: FeeCalculationInput): bigint {
  const area = input.cuttingLength * input.cuttingWidth;
  let ratePerSqm = 100000n; // Rs 1000 per sqm default
  if (input.roadType === "arterial") ratePerSqm = 250000n;
  else if (input.roadType === "sub_arterial") ratePerSqm = 200000n;
  else if (input.roadType === "collector") ratePerSqm = 150000n;
  return BigInt(Math.ceil(area)) * ratePerSqm;
}

export function calculateDepositMinor(input: FeeCalculationInput): bigint {
  const area = input.cuttingLength * input.cuttingWidth;
  let depositPerSqm = 200000n; // Rs 2000 per sqm default
  if (input.roadType === "arterial") depositPerSqm = 500000n;
  else if (input.roadType === "sub_arterial") depositPerSqm = 400000n;
  else if (input.roadType === "collector") depositPerSqm = 300000n;
  return BigInt(Math.ceil(area)) * depositPerSqm;
}

export function generateApplicationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `ROADCUT/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
