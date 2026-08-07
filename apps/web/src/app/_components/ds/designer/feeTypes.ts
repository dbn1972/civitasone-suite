import type { EligibilityOp } from "./eligibilityTypes";

export type FeeModelUi = "flat" | "slab" | "engine";

export type ExemptionKindUi = "waive" | "percent" | "flat";

export interface FeeExemptionUi {
  id: string;
  attribute: string;
  op: EligibilityOp;
  value: string;
  kind: ExemptionKindUi;
  /** Percent (0–100) or flat reduction in paise; ignored for waive. */
  amount: string;
  label: string;
}

export type SlabTypeUi = "flat" | "band" | "ad_valorem";

export interface SlabRowUi {
  id: string;
  from: string;
  to: string;
  /** Rate in paise (flat/band) or basis points (ad_valorem). */
  rate: string;
  type: SlabTypeUi;
  /** Inline validation message when gaps or overlaps are detected. */
  issue?: string;
}

export type DemandTrigger = "submission" | "approval";

export interface FeeDesignState {
  feeModel: FeeModelUi | null;
  scheduleId?: string;
  rateHeadId?: string;
  name: string;
  baseAmountPaise: number;
  exemptions: FeeExemptionUi[];
  slabs: SlabRowUi[];
  /** Form field apiName used for slab sample input. */
  slabVariable: string;
  formula?: string;
  engineParams: Record<string, string>;
  hoaCode: string;
  demandTrigger: DemandTrigger;
  rebateDays: number;
  penaltyDays: number;
}

export interface DemandLine {
  label: string;
  amountPaise: number;
}

export interface SampleCalculation {
  lines: DemandLine[];
  totalPaise: number;
  currency: string;
}
