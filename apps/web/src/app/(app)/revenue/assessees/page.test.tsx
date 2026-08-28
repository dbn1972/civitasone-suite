import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import AssesseesPage from "./page";

const ASSESSEE = {
  id: "11111111-1111-1111-1111-111111111111",
  assesseeType: "property",
  identifierNo: "PROP-0001",
  ownerName: "Ramesh Kumar",
  address: "12 MG Road",
  wardNo: "4",
  zoneNo: "1",
  propertyType: "residential",
  isActive: true,
};

describe("AssesseesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the assessee list", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ASSESSEE], source: "api" });
    const ui = await AssesseesPage();
    render(ui);

    expect(screen.getByText("PROP-0001")).toBeInTheDocument();
    expect(screen.getByText("Ramesh Kumar")).toBeInTheDocument();
  });

  it("renders an empty state when there are no assessees", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await AssesseesPage();
    render(ui);

    expect(screen.getByText("No assessees registered")).toBeInTheDocument();
  });

  it("shows the data-source badge instead of a friendly empty state on error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await AssesseesPage();
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
    expect(screen.queryByText("No assessees registered")).not.toBeInTheDocument();
  });
});
