import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { MatrixTable } from "./MatrixTable";
import type { MatrixRuleRow } from "../_data";

const rows: MatrixRuleRow[] = [
  {
    id: "m-1",
    source: "prod-A",
    target: "prod-B",
    segment: "retail",
    channel: "web",
    priority: 5,
    weightBps: 2500,
    effectiveFrom: null,
    effectiveTo: null,
  },
];

describe("MatrixTable (GAP-RECOMMENDATIONS-MATRIX-02/03)", () => {
  it("renders Source/Target/Weight as separate columns", () => {
    render(<MatrixTable rows={rows} />);
    expect(screen.getByRole("columnheader", { name: "Source product" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Target product" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Weight/ })).toBeInTheDocument();
    expect(screen.getByText("prod-A")).toBeInTheDocument();
    expect(screen.getByText("prod-B")).toBeInTheDocument();
  });

  it("renders weight bps as a percentage (2500 bps = 25%)", () => {
    render(<MatrixTable rows={rows} />);
    expect(screen.getByText("25%")).toBeInTheDocument();
  });

  it("shows an empty state when there are no rules", () => {
    render(<MatrixTable rows={[]} />);
    expect(screen.getByText(/No cross-sell rules/i)).toBeInTheDocument();
  });
});
