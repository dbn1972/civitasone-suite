import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import ProcurementDashboardPage from "./page";

const MOCK_DASHBOARD = { pendingIndents: 5, activePOs: 18, grnsThisMonth: 9, contractRenewalsDue: 2 };

function mockProcurementLoader(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/procurement/dashboard")) return Promise.resolve(result);
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("ProcurementDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real stat counts when the loader succeeds", async () => {
    mockProcurementLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await ProcurementDashboardPage());
    expect(screen.getByText("Pending Indents").closest(".stat")).toHaveTextContent("5");
    expect(screen.getByText("Active POs").closest(".stat")).toHaveTextContent("18");
  });

  it("renders — for every stat, not a fabricated zero, when the loader fails", async () => {
    // Bug A / UX-013: `source` was already fetched here but only wired to a
    // DataSourceBadge whose own copy claims "Couldn't load — showing
    // nothing" -- contradicted by the stat grid actually showing "0" for
    // every card. Gate every stat on it instead.
    mockProcurementLoader({
      data: { pendingIndents: 0, activePOs: 0, grnsThisMonth: 0, contractRenewalsDue: 0 },
      source: "error",
    });
    render(await ProcurementDashboardPage());
    expect(screen.getByText("Pending Indents").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Active POs").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("GRNs (MTD)").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Contract Renewals Due").closest(".stat")).toHaveTextContent("—");
  });
});
