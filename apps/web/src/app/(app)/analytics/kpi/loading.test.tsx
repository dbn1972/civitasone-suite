import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import KpiLoading from "./loading";

// GAP-ANALYTICS-KPI-04 / KPI-05 regressions (W2).
describe("kpi loading + page hygiene", () => {
  it("KPI-04: loading renders the stat+table skeleton, not one blank block", () => {
    const { container } = render(<KpiLoading />);
    expect(screen.getAllByText(/Loading/i).length).toBeGreaterThan(0);
    // 4 stat-card placeholders + 6 table rows are aria-hidden shimmer blocks.
    expect(container.querySelectorAll("[aria-hidden=true]").length).toBeGreaterThan(10);
  });

  it("KPI-05: page.tsx has no hex colour literals", () => {
    const src = readFileSync(join(__dirname, "page.tsx"), "utf8");
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("KPI-05: KpiTable audits its CSV export", () => {
    const src = readFileSync(join(__dirname, "KpiTable.tsx"), "utf8");
    expect(src).toContain('exportAudit="analytics/kpi"');
  });
});
