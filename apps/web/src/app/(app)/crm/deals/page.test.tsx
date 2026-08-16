import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";
import { getDeals } from "../../../_data/loaders";

vi.mock("../../../_data/loaders", () => ({ getDeals: vi.fn() }));
vi.mock("./DealsTable", () => ({ DealsTable: () => <div data-testid="deals-table" /> }));

const MOCK_DEALS = [
  {
    id: "1",
    dealName: "Procurement Engagement A",
    contactName: "Officer A",
    amount: 5000000,
    stage: "prospecting" as const,
    status: "open" as const,
    owner: "User 1",
    probability: 40,
  },
  {
    id: "2",
    dealName: "Procurement Engagement B",
    contactName: "Officer B",
    amount: 2000000,
    stage: "closed_won" as const,
    status: "won" as const,
    owner: "User 2",
    probability: 100,
  },
];

describe("Deals Page", () => {
  beforeEach(() => {
    vi.mocked(getDeals).mockResolvedValue({ data: MOCK_DEALS, source: "api" });
  });

  it("renders 'Vendor / Stakeholder Engagements' heading", async () => {
    render(await Page());
    expect(
      screen.getByRole("heading", { name: /Vendor \/ Stakeholder Engagements/i }),
    ).toBeInTheDocument();
  });

  it("shows 'Active Procurement Value' stat label", async () => {
    render(await Page());
    expect(screen.getByText("Active Procurement Value")).toBeInTheDocument();
  });

  it("shows 'Concluded Value' stat label (not 'Completed Value')", async () => {
    render(await Page());
    expect(screen.getByText("Concluded Value")).toBeInTheDocument();
    expect(screen.queryByText("Completed Value")).not.toBeInTheDocument();
  });

  it("renders stats with real data — 2 total, 1 active", async () => {
    render(await Page());
    // Total Engagements = 2
    expect(screen.getByText("2")).toBeInTheDocument();
    // Active Engagements = 1 (only status=open)
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders DealsTable component", async () => {
    render(await Page());
    expect(screen.getByTestId("deals-table")).toBeInTheDocument();
  });
});
