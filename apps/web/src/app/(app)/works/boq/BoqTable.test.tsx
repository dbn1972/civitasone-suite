import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initialData: unknown[]) => ({
    data: initialData,
    provenance: "live",
    offline: false,
    cachedAt: null,
  }),
}));

import { BoqTable } from "./BoqTable";

const rows = [
  { id: "x1", workId: "w-1", work: "WRK-2026-0007", itemCode: "SR-1", srItemId: "sr-1", description: "PCC", unit: "cum", rate: "12500", quantity: "2", amount: "25000", scope: "ab12cd34…" },
];

describe("BoqTable", () => {
  it("GAP-WORKS-BOQ-01: shows a Work column with the work number so rows are identifiable", () => {
    render(<BoqTable items={rows} source="api" />);
    expect(screen.getByText("Work")).toBeInTheDocument();
    expect(screen.getByText("WRK-2026-0007")).toBeInTheDocument();
  });

  it("GAP-WORKS-BOQ-03: empty state uses the corrected copy and a CTA (no 'once a work is selected')", () => {
    render(<BoqTable items={[]} source="api" />);
    expect(screen.getByText("No BoQ items yet. Add an item to a work to get started.")).toBeInTheDocument();
    expect(screen.queryByText(/once a work is selected/i)).not.toBeInTheDocument();
    const cta = screen.getByRole("link", { name: /Add BoQ item/i });
    expect(cta).toHaveAttribute("href", "/works/boq/new");
  });
});
