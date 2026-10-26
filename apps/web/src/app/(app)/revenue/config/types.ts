export interface RateHeadRow {
  id: string;
  code: string;
  name: string;
  category: string;
  unitOfMeasure: string | null;
  isActive: boolean;
  /** Owner decision #2: deactivation is an end-date. */
  effectiveTo?: string | null;
}

export type SlabType = "flat" | "ad_valorem" | "band";

export interface RateSlabRow {
  id: string;
  rateHeadId: string;
  slabType: SlabType;
  /** Paise. null for flat slabs. */
  bandFrom: string | null;
  /** Paise. null for flat slabs / open-ended bands. */
  bandTo: string | null;
  /** Paise for flat/band slabs, basis points for ad_valorem slabs. */
  rateValue: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isActive: boolean;
  version?: number;
}

export type InterestType = "simple" | "compound";
export type RoundingMode = "floor" | "ceil" | "round_half_up";

export interface PenaltyRuleRow {
  id: string;
  rateHeadId: string;
  interestType: InterestType;
  /** Basis points, e.g. 1200 = 12% p.a. */
  annualRateBps: number;
  graceDays: number;
  capMonths: number | null;
  roundingMode: RoundingMode;
  isActive: boolean;
  /** Owner decision #2: versioned, effective-dated. */
  effectiveFrom?: string;
  effectiveTo?: string | null;
  version?: number;
}

export interface RebateRuleRow {
  id: string;
  rateHeadId: string;
  rebateType: string;
  /** Basis points, e.g. 500 = 5% */
  discountBps: number;
  validUntilDaysBeforeDue: number | null;
  isActive: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
  version?: number;
}

export interface AcceptedResponse {
  id: string;
  status: string;
  correlationId?: string;
}
