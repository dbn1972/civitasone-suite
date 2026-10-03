import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { PeriodsTable, type PeriodRow } from "./PeriodsTable";

const ID = "11111111-1111-1111-1111-111111111111";
const base: PeriodRow = { period: "2026-04", fiscalYear: "2026-27", status: "soft_close", closedBy: ID, closedAt: "2026-05-02T00:00:00.000Z" };

describe("PeriodsTable Closed By (GAP-FINANCE-PERIOD-CLOSE-06)", () => {
  it("shows the resolved person's name, never the raw id", () => {
    render(<PeriodsTable periods={[{ ...base, closedByName: "Asha Verma" }]} />);
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.queryByText(ID)).not.toBeInTheDocument();
  });
  it("falls back to a shortened neutral label when the name could not be resolved", () => {
    render(<PeriodsTable periods={[{ ...base, closedByName: null }]} />);
    expect(screen.getByText("User 11111111")).toBeInTheDocument();
  });
});
