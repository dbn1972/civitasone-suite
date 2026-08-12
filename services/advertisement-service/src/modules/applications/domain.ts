export const APPLICATION_STATUSES = [
  "draft",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "withdrawn",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export const VALID_TRANSITIONS: Record<string, ApplicationStatus[]> = {
  draft: ["submitted", "withdrawn"],
  submitted: ["under_review", "withdrawn"],
  under_review: ["approved", "rejected"],
  approved: [],
  rejected: [],
  withdrawn: [],
};

export function canTransition(from: string, to: ApplicationStatus): boolean {
  return (VALID_TRANSITIONS[from] ?? []).includes(to);
}

export const ADVERTISEMENT_TYPES = [
  "hoarding",
  "banner",
  "signage",
  "kiosk",
  "digital",
] as const;

export type AdvertisementType = (typeof ADVERTISEMENT_TYPES)[number];

export interface FeeCalculationInput {
  advertisementType: string;
  dimensions: { widthFt: number; heightFt: number; areaInSqFt: number };
}

export function calculateFeeMinor(input: FeeCalculationInput): bigint {
  const area = input.dimensions.areaInSqFt;
  let ratePerSqFt = 5000n; // Rs 50 per sqft default (paise)

  switch (input.advertisementType) {
    case "hoarding":
      ratePerSqFt = 10000n; // Rs 100/sqft
      break;
    case "digital":
      ratePerSqFt = 15000n; // Rs 150/sqft
      break;
    case "banner":
      ratePerSqFt = 3000n; // Rs 30/sqft
      break;
    case "signage":
      ratePerSqFt = 5000n; // Rs 50/sqft
      break;
    case "kiosk":
      ratePerSqFt = 8000n; // Rs 80/sqft
      break;
  }

  const fee = ratePerSqFt * BigInt(Math.ceil(area));
  return fee < 500000n ? 500000n : fee; // minimum Rs 5000
}

export function generateApplicationNumber(tenantShortCode: string, sequence: number): string {
  const year = new Date().getUTCFullYear();
  return `ADV/${tenantShortCode}/${year}/${String(sequence).padStart(6, "0")}`;
}
