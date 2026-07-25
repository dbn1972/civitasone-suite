export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

export type PlanStatus = "draft" | "pending" | "approved" | "rejected";

export const PROCUREMENT_CATEGORIES = ["goods", "services", "works"] as const;
export const PROCUREMENT_METHODS = [
  "direct_purchase", "gem", "limited_tender", "advertised_tender", "single_tender",
] as const;

const VALID_TRANSITIONS: Record<PlanStatus, PlanStatus[]> = {
  draft:    ["pending"],
  pending:  ["approved", "rejected"],
  approved: [],
  rejected: ["pending"],
};

export function assertTransitionAllowed(from: string, to: PlanStatus): void {
  const allowed = VALID_TRANSITIONS[from as PlanStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `plan cannot transition from '${from}' to '${to}'`);
  }
}

/** Maker-checker: the approver (checker) must differ from the submitter/creator (maker). */
export function assertDistinctMakerChecker(makerId: string, checkerId: string): void {
  if (makerId && checkerId && makerId === checkerId) {
    throw new DomainError("SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
  }
}

export interface DemandInput {
  itemCode: string;
  description: string;
  quantity: number;
  uom?: string | undefined;
  unitPriceMinor: bigint;
  procurementCategory?: string | undefined;
  procurementMethod?: string | undefined;
  budgetLine?: string | undefined;
  timelineQuarter?: string | undefined;
  packageGroup?: string | undefined;
  sourceIndentId?: string | undefined;
}

export interface AggregatedLine {
  itemCode: string;
  description: string;
  aggregatedQty: number;
  uom: string;
  procurementCategory: string;
  procurementMethod: string;
  budgetLine: string | null;
  estimatedValueMinor: bigint;
  timelineQuarter: string | null;
  packageGroup: string | null;
  sourceIndentIds: string[];
}

/**
 * Aggregate yearly demand into plan lines. Demand rows for the same
 * (itemCode, procurementCategory, budgetLine, timelineQuarter) are summed:
 * quantity accumulates and estimatedValueMinor = Σ(unitPriceMinor × quantity).
 * De-duplicates and preserves the source indent ids for traceability.
 */
export function aggregateDemand(rows: DemandInput[]): AggregatedLine[] {
  const groups = new Map<string, AggregatedLine>();
  for (const r of rows) {
    const category = r.procurementCategory ?? "goods";
    const method = r.procurementMethod ?? "gem";
    const budgetLine = r.budgetLine ?? null;
    const quarter = r.timelineQuarter ?? null;
    const key = [r.itemCode, category, budgetLine ?? "", quarter ?? ""].join("|");
    const lineValue = BigInt(r.unitPriceMinor) * BigInt(r.quantity);

    const existing = groups.get(key);
    if (existing) {
      existing.aggregatedQty += r.quantity;
      existing.estimatedValueMinor += lineValue;
      if (r.sourceIndentId && !existing.sourceIndentIds.includes(r.sourceIndentId)) {
        existing.sourceIndentIds.push(r.sourceIndentId);
      }
    } else {
      groups.set(key, {
        itemCode: r.itemCode,
        description: r.description,
        aggregatedQty: r.quantity,
        uom: r.uom ?? "nos",
        procurementCategory: category,
        procurementMethod: method,
        budgetLine,
        estimatedValueMinor: lineValue,
        timelineQuarter: quarter,
        packageGroup: r.packageGroup ?? null,
        sourceIndentIds: r.sourceIndentId ? [r.sourceIndentId] : [],
      });
    }
  }
  return [...groups.values()];
}

/** Plan total = Σ line estimated values (paise). */
export function planTotalMinor(lines: Array<{ estimatedValueMinor: bigint }>): bigint {
  return lines.reduce((s, l) => s + BigInt(l.estimatedValueMinor), 0n);
}

export function assertPlanApprovedForLinkage(status: string): void {
  if (status !== "approved") {
    throw new DomainError("PLAN_NOT_APPROVED", `tender linkage requires an approved plan, got '${status}'`);
  }
}
