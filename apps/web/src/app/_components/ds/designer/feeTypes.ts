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

/** Sample rail payment timing — drives rebate / penalty preview lines. */
export type SamplePaymentScenario = "on_time" | "early" | "late";

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
  /** Designer-preview rebate percent when paying within rebateDays (0–100). */
  rebatePercent: number;
  penaltyDays: number;
  /** Designer-preview penalty percent after grace (0–100). */
  penaltyPercent: number;
}

export type DemandLineKind = "base" | "exemption" | "rebate" | "penalty" | "info";

export interface DemandLine {
  label: string;
  amountPaise: number;
  /** UPYOG-style tax head for demand parity (preview). */
  taxHeadCode?: string;
  kind?: DemandLineKind;
}

export interface SampleCalculation {
  lines: DemandLine[];
  totalPaise: number;
  currency: string;
  hoaCode?: string;
  scenario?: SamplePaymentScenario;
}
