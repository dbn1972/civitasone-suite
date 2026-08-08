/** FN-21 — Designer engine binding UI types (mirrors citizen-service engine-bindings domain). */

export type EngineBlockUi = "fee" | "assessment" | "verification" | "numbering" | "inspection";

export type EngineKeyUi =
  | "revenue.assessment"
  | "revenue.rate-engine"
  | "revenue.billing"
  | "inspection.planning"
  | "police.verification"
  | "crs.birth-death";

export interface ExemptionCategoryUi {
  code: string;
  label: string;
  /** Basis points (10000 = 100%). */
  percentBps: number;
}

export interface EngineBindingConfigUi {
  exemptionCategories: ExemptionCategoryUi[];
  penaltyPercentBps: number;
  rebatePercentBps: number;
  rebateWindowDays: number;
  penaltyGraceDays: number;
  hoaCode: string;
  extras: Record<string, string>;
}

export interface EngineBindingUi {
  id: string;
  block: EngineBlockUi;
  engineKey: EngineKeyUi;
  config: EngineBindingConfigUi;
  requiredForPublish: boolean;
}

export interface EngineParamFieldUi {
  key: string;
  label: string;
  type: "string" | "number" | "percent_bps" | "days" | "hoa" | "exemption_list";
  required?: boolean;
  help?: string;
}

export interface EngineDescriptorUi {
  engineKey: EngineKeyUi;
  label: string;
  description: string;
  blocks: EngineBlockUi[];
  available: boolean;
  unavailableReason?: string;
  configSchema: EngineParamFieldUi[];
  defaultConfig: EngineBindingConfigUi;
}

export interface EnginePreviewLineUi {
  taxHeadCode: string;
  label: string;
  amountMinor: number;
}

export interface EnginePreviewResultUi {
  engineKey: EngineKeyUi;
  available: boolean;
  lines: EnginePreviewLineUi[];
  totalMinor: number;
  currency: string;
  appliedExemptions: string[];
  note: string;
}

export function emptyEngineBindingConfig(): EngineBindingConfigUi {
  return {
    exemptionCategories: [],
    penaltyPercentBps: 0,
    rebatePercentBps: 0,
    rebateWindowDays: 0,
    penaltyGraceDays: 0,
    hoaCode: "",
    extras: {},
  };
}

export function hasFeeEngineBinding(bindings: readonly EngineBindingUi[]): boolean {
  return bindings.some(
    (b) =>
      (b.block === "fee" || b.block === "assessment")
      && (b.engineKey === "revenue.assessment"
        || b.engineKey === "revenue.rate-engine"
        || b.engineKey === "revenue.billing"),
  );
}

export function bpsToPercentInput(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 2);
}

export function percentInputToBps(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(10_000, Math.round(n * 100));
}
