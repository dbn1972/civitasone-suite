import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * SF-12 guard: no float rupees->paise conversion anywhere in apps/web/src.
 * Money goes through rupeesToMinorString / rupeesInputToMinorNumber /
 * rupeesNumberToMinorString in "@/lib/money" (string parse, exact).
 *
 * Flags (outside comments and *.test.* files):
 *   Math.round(<x> * 100)   Number(<x>) * 100   parseFloat(<x>) * 100
 *
 * Ratio maths such as Math.round((a / b) * 100) is a percentage and is not matched.
 *
 * ALLOWED holds the only files where those expressions are NOT money. The value
 * is the exact number of matching lines, so a new hit in an allow-listed file
 * still fails. Do not add a money site here -- fix it instead.
 */
const ALLOWED: Record<string, number> = {
  // fraction (0..1) -> percent for display
  "app/(app)/admin/bulk-scan/_components/ReviewPanels.tsx": 1,
  "app/(app)/admin/bulk-scan/_components/SettingsFields.tsx": 1,
  "app/(app)/ai/copilot/[id]/page.tsx": 1,
  "app/(app)/analytics/ml-insights/page.tsx": 1,
  "app/(app)/analytics/ml-insights/_components/AccuracyTrendChart.tsx": 2,
  "app/(app)/analytics/ml-insights/_components/DomainInsightPage.tsx": 1,
  "app/(app)/analytics/ml-insights/_components/FactorBreakdown.tsx": 1,
  "app/(app)/analytics/ml-insights/_components/RecentPredictionsTable.tsx": 1,
  "app/(app)/cdp/steward/StewardQueuePanel.tsx": 1,
  "app/(app)/crm/health/[accountId]/page.tsx": 1,
  "app/(app)/crm/pipeline/_components/DealCard.tsx": 1,
  "app/(app)/helpdesk/tickets/TicketsTable.tsx": 1,
  "app/(app)/projects/[id]/ProjectDetailTables.tsx": 1,
  "app/(app)/tenant-admin/activation/ActivationView.tsx": 2,
  "app/_components/crm/DataQualityView.tsx": 1,
  "app/_components/ds/ConfidenceBar.tsx": 1,
  "app/_components/ds/PredictionBadge.tsx": 1,
  "app/_components/ds/PredictionHistory.tsx": 3,
  "lib/bulkScan/viewer.ts": 1, // zoom factor
  // percent -> basis points (not rupees)
  "app/_components/ds/designer/engineBindingTypes.ts": 2,
  "app/(app)/assets/leases/leaseTerms.ts": 1,
  // 2-decimal rounding of weights/splits/hours (not money)
  "app/(app)/hr/apar/[id]/AparStageActions.tsx": 1,
  "app/(app)/hr/payroll/costing/CostingRulesTable.tsx": 1,
  "app/(app)/hr/overtime/mapOvertime.ts": 2,
  // YYYYMM period keys
  "app/(app)/hr/payroll/salary-slips/slipPeriods.ts": 2,
  "app/(app)/works/execution/record-progress/page.tsx": 1,
};

const FLOAT_MONEY = [
  /Math\.round\(\s*[^()\n]*\*\s*100\s*\)/,
  /Number\([^)\n]*\)\s*\*\s*100\b/,
  /parseFloat\([^)\n]*\)\s*\*\s*100\b/,
  /Math\.round\(\s*(?:Number|parseFloat)\(.*\)\s*\*\s*100\b/, // nested-paren form
];

const SRC = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : sources(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

function hits(file: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((line, i) => ({ i: i + 1, line }))
    .filter(({ line }) => {
      const t = line.trim();
      if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) return false;
      const code = line.replace(/\s\/\/.*$/, "");
      return FLOAT_MONEY.some((re) => re.test(code));
    })
    .map(({ i, line }) => `${i}: ${line.trim()}`);
}

describe("SF-12 float-money guard", () => {
  const found = new Map<string, string[]>();
  for (const f of sources(SRC)) {
    const h = hits(f);
    if (h.length) found.set(relative(SRC, f).split(sep).join("/"), h);
  }

  it("has no float `*100` conversion outside the percentage allow-list", () => {
    const offenders = [...found.entries()]
      .filter(([f, h]) => h.length !== (ALLOWED[f] ?? 0))
      .map(([f, h]) => `${f} (allowed ${ALLOWED[f] ?? 0}, found ${h.length})\n  ${h.join("\n  ")}`);
    expect(offenders, "Use rupeesToMinorString / rupeesInputToMinorNumber from @/lib/money").toEqual([]);
  });

  it("keeps the allow-list free of stale entries", () => {
    const stale = Object.keys(ALLOWED).filter((f) => !found.has(f));
    expect(stale).toEqual([]);
  });

  it("detects the banned patterns", () => {
    const sample = ["Math.round(rupees * 100)", "Number(x) * 100", "parseFloat(v)*100"];
    for (const s of sample) expect(FLOAT_MONEY.some((re) => re.test(s))).toBe(true);
    expect(FLOAT_MONEY.some((re) => re.test("Math.round(a / b)"))).toBe(false);
  });
});
