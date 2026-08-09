export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "noc_pending",
  "nocs_received",
  "approved",
  "rejected",
  "permitted",
  "completed",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const VALID_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  draft: ["submitted"],
  submitted: ["noc_pending", "approved", "rejected"],
  noc_pending: ["nocs_received"],
  nocs_received: ["approved", "rejected"],
  approved: ["permitted"],
  permitted: ["completed"],
  rejected: [],
  completed: [],
};

export function canTransition(from: string, to: ApplicationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const EVENT_TYPES = [
  "cultural",
  "religious",
  "sports",
  "political",
  "commercial",
  "government",
] as const;

export interface FeeCalculationInput {
  eventType: string;
  expectedAttendance: number;
  soundPermission: boolean;
}

export function calculateFeeMinor(input: FeeCalculationInput): bigint {
  let baseFee = 500000n; // Rs 5000 default
  if (input.eventType === "commercial") baseFee = 2000000n;
  else if (input.eventType === "political") baseFee = 1000000n;
  else if (input.eventType === "government") baseFee = 0n;
  if (input.expectedAttendance > 500) {
    baseFee += BigInt(Math.floor((input.expectedAttendance - 500) / 100)) * 50000n;
  }
  if (input.soundPermission) baseFee += 200000n;
  return baseFee;
}

export function calculateDepositMinor(input: FeeCalculationInput): bigint {
  let deposit = 1000000n; // Rs 10000 default
  if (input.expectedAttendance > 1000) deposit = 5000000n;
  else if (input.expectedAttendance > 500) deposit = 2500000n;
  return deposit;
}

export function generateApplicationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `EVT/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}

export function determineRequiredNocs(eventType: string, expectedAttendance: number, soundPermission: boolean): string[] {
  const nocs: string[] = ["police"];
  if (expectedAttendance > 200) nocs.push("fire");
  if (expectedAttendance > 100) nocs.push("traffic");
  if (eventType === "cultural" || eventType === "religious" || eventType === "commercial") nocs.push("health");
  if (soundPermission) nocs.push("environment");
  return nocs;
}
