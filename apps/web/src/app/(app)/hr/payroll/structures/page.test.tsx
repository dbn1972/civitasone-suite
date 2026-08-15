import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import PayStructuresPage from "./page";

describe("PayStructuresPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders salary structure cards with structure names", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [
          { id: "s1", name: "Standard Grade Pay", isDefault: true, status: "active" },
          { id: "s2", name: "Contractual Pay", isDefault: false, status: "active" },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await PayStructuresPage();
    render(ui);

    expect(screen.getByText("Standard Grade Pay")).toBeInTheDocument();
    expect(screen.getByText("Contractual Pay")).toBeInTheDocument();
  });

  it("renders an empty state when there are no structures", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    const ui = await PayStructuresPage();
    render(ui);

    expect(screen.getByText("No pay structures yet")).toBeInTheDocument();
  });

  it("renders component grid when components are present", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [{ id: "s1", name: "Basic Pay Structure", isDefault: true, status: "active" }],
        source: "api",
      })
      .mockResolvedValueOnce({
        data: [
          { id: "c1", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: true, structureId: "s1" },
          { id: "c2", code: "DA", name: "Dearness Allowance", componentType: "earning", isTaxable: true, structureId: "s1" },
          { id: "c3", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: false, structureId: "s1" },
        ],
        source: "api",
      });

    const ui = await PayStructuresPage();
    render(ui);

    expect(screen.getByText("Basic Pay")).toBeInTheDocument();
    expect(screen.getByText("Dearness Allowance")).toBeInTheDocument();
    expect(screen.getByText("House Rent Allowance")).toBeInTheDocument();
  });

  it("shows stat cards with correct counts", async () => {
    fetchJsonMock
      .mockResolvedValueOnce({
        data: [
          { id: "s1", name: "Group A Pay", isDefault: true, status: "active" },
          { id: "s2", name: "Group C Pay", isDefault: false, status: "inactive" },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({
        data: [
          { id: "c1", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: true, structureId: "s1" },
        ],
        source: "api",
      });

    const ui = await PayStructuresPage();
    render(ui);

    // Total structures = 2, active = 1, default = 1, components = 1
    expect(screen.getByText("2")).toBeInTheDocument(); // total or active
    expect(screen.getByText("Total Structures")).toBeInTheDocument();
  });
});
