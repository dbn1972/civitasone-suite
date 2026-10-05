import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";
import { getDeals } from "../../../_data/loaders";

vi.mock("../../../_data/loaders", () => ({ getDeals: vi.fn() }));
// The stat cards + data-source badge now live inside DealsTable (GAP-CRM-DEALS-03),
// so the page test only verifies the header and that the table is rendered with
// the server data; the stat/segment/money behaviour is covered in DealsTable.test.tsx.
vi.mock("./DealsTable", () => ({
  DealsTable: ({ deals }: { deals: unknown[] }) => (
    <div data-testid="deals-table" data-count={deals.length} />
  ),
}));

const MOCK_DEALS = [
  {
    id: "1",
    dealName: "Procurement Engagement A",
    contactName: "Officer A",
    // GAP-CRM-DEALS-04: amount is now a minor-unit (paise) string, not a number.
    amount: "5000000",
    stage: "prospecting" as const,
    status: "open" as const,
    owner: "User 1",
    probability: 40,
  },
  {
    id: "2",
    dealName: "Procurement Engagement B",
    contactName: "Officer B",
    amount: "2000000",
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

  it("renders DealsTable with the loaded deals", async () => {
    render(await Page());
    const table = screen.getByTestId("deals-table");
    expect(table).toBeInTheDocument();
    expect(table).toHaveAttribute("data-count", "2");
  });
});
