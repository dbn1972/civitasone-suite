import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import RetirementPage from "./page";

describe("RetirementPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("tells the truth on a fetch failure instead of the old 'Showing saved information' copy", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    const ui = await RetirementPage();
    render(ui);

    expect(screen.getByText("Couldn't load retirement records — showing nothing")).toBeInTheDocument();
  });

  it("renders the full register and the case workspace together for real data", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "e1", employee: "Meena Iyer", department: "Revenue", designation: "Tehsildar", superannuationDate: "2027-01-15", separationType: "Superannuation", status: "pending" },
      ],
      source: "api",
    });

    const ui = await RetirementPage();
    render(ui);

    // Appears both in the register table and the upcoming-retirements card.
    expect(screen.getAllByText("Meena Iyer").length).toBeGreaterThan(0);
  });
});
