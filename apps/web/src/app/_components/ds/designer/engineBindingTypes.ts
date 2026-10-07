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

/**
 * GAP-DESIGNER-DETAIL-ENGINES-02: validate a percent input instead of silently
 * clamping/zeroing. Silent coercion of e.g. "150" or "-5" to 0 could zero a
 * penalty that feeds tax computation. Returns a structured result so the UI can
 * show an inline error and block Save.
 */
export type PercentParseResult =
  | { ok: true; bps: number }
  | { ok: false; error: string };

export function parsePercentToBps(value: string): PercentParseResult {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { ok: false, error: "Enter a percentage (0–100)." };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    return { ok: false, error: "Enter a percentage 0–100 with up to 2 decimal places." };
  }
  const n = Number(trimmed);
  if (n < 0 || n > 100) return { ok: false, error: "Percentage must be between 0 and 100." };
  return { ok: true, bps: Math.round(n * 100) };
}

/** GAP-DESIGNER-DETAIL-ENGINES-02: validate a whole-day count (0–365). */
export type DaysParseResult =
  | { ok: true; days: number }
  | { ok: false; error: string };

export function parseDays(value: string): DaysParseResult {
  const trimmed = (value ?? "").trim();
  if (trimmed === "") return { ok: false, error: "Enter a number of days." };
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: "Enter a whole number of days." };
  const n = Number(trimmed);
  if (n < 0 || n > 365) return { ok: false, error: "Days must be between 0 and 365." };
  return { ok: true, days: n };
}

/**
 * Validate a whole engine binding config. Returns a list of human-readable
 * errors; empty means valid. Includes the cross-field check that exemption
 * percentages do not sum above 100%.
 */
export function validateEngineConfig(config: EngineBindingConfigUi): string[] {
  const errors: string[] = [];
  if (config.penaltyPercentBps < 0 || config.penaltyPercentBps > 10_000) {
    errors.push("Penalty percentage must be between 0 and 100.");
  }
  if (config.rebatePercentBps < 0 || config.rebatePercentBps > 10_000) {
    errors.push("Rebate percentage must be between 0 and 100.");
  }
  if (config.rebateWindowDays < 0 || config.rebateWindowDays > 365) {
    errors.push("Rebate window must be between 0 and 365 days.");
  }
  if (config.penaltyGraceDays < 0 || config.penaltyGraceDays > 365) {
    errors.push("Penalty grace must be between 0 and 365 days.");
  }
  const exemptionTotal = config.exemptionCategories.reduce((sum, c) => sum + c.percentBps, 0);
  if (exemptionTotal > 10_000) {
    errors.push("Exemption percentages add up to more than 100%.");
  }
  return errors;
}

/**
 * GAP-DESIGNER-DETAIL-ENGINES-03: turn a raw dotted engine key such as
 * "revenue.assessment" into a human-readable fallback label ("Revenue
 * Assessment") when the registry does not provide a display name.
 */
export function humanizeEngineKey(key: string): string {
  return key
    .split(/[._]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
