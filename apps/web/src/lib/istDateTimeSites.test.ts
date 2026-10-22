import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// CLOS-S1-16: these components rendered `new Date(x).toLocaleString("en-IN")`
// (browser zone, "Invalid Date" on bad input). They must use the IST
// formatIndianDateTime helper from @/lib/formatters instead.
const APP = join(__dirname, "..", "app", "(app)");
const SITES = [
  "admin/integrations/_components/IntegrationDrawer.tsx",
  "analytics/kpi/KpiTable.tsx",
  "analytics/data-warehouse/DataWarehouseTable.tsx",
  "analytics/ai-insights/AiInsightsTable.tsx",
  "approvals/_components/ApprovalsTable.tsx",
  "crm/pipeline/_components/KanbanBoard.tsx",
];
const DATE_RECEIVER_LOCALE = /new Date\([^)]*\)\.toLocaleString\s*\(/;

describe("CLOS-S1-16 IST date-time sites", () => {
  it.each(SITES)("%s formats timestamps via formatIndianDateTime, not new Date().toLocaleString", (rel) => {
    const src = readFileSync(join(APP, rel), "utf8");
    expect(DATE_RECEIVER_LOCALE.test(src)).toBe(false);
    expect(src).toContain("formatIndianDateTime");
  });
});
