import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/estab/quarters",
  useSearchParams: () => new URLSearchParams(),
}));

import { QuartersTable, type QuarterRow } from "./QuartersTable";

function row(over: Partial<QuarterRow>): QuarterRow {
  return {
    id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    quarterNo: "B-14",
    quarterType: "type_iv",
    category: "general",
    address: null,
    locality: "Sector 12",
    carpetAreaSqft: 850,
    status: "vacant",
    condition: "good",
    orgUnit: null,
    version: 1,
    ...over,
  } as QuarterRow;
}

describe("QuartersTable — Category column (GAP-ESTAB-QUARTERS-04)", () => {
  it("renders an other_legacy quarter as the localised label, not the raw enum", () => {
    render(<QuartersTable quarters={[row({ category: "other_legacy" })]} />);
    expect(screen.getByText("Other (legacy)")).toBeInTheDocument();
    expect(screen.queryByText("other_legacy")).not.toBeInTheDocument();
  });

  it("renders a closed-list category through its translation key", () => {
    render(<QuartersTable quarters={[row({ id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", category: "physically_handicapped" })]} />);
    expect(screen.getByText("Physically handicapped")).toBeInTheDocument();
    expect(screen.queryByText("physically_handicapped")).not.toBeInTheDocument();
  });
});
