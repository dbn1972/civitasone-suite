import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/_data/loaders", () => ({
  getFinanceAuditParaById: vi.fn(async () => ({
    source: "api",
    status: 200,
    data: {
      id: "p1", paraNo: "7/2025", source: "CAG", dept: "Roads", moneyValueMinor: "530000000",
      status: "open", createdAt: "2026-09-01T05:30:00.000Z", updatedAt: "2026-09-02T05:30:00.000Z", version: 1,
    },
  })),
}));

import AuditParaDetailPage from "./page";

describe("AuditParaDetailPage (GAP-FINANCE-AUDIT-PARAS-DETAIL-03/05)", () => {
  it("humanizes the Status card (not the raw 'open') and formats dates as dd Mon yyyy", async () => {
    render(await AuditParaDetailPage({ params: { id: "p1" } }));
    const card = screen.getByText("Status", { selector: ".stat *" }).closest(".stat");
    expect(card).toHaveTextContent("Open");
    expect(card).not.toHaveTextContent(/\bopen\b/);
    expect(screen.getByText("01 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText(/T05:30:00/)).not.toBeInTheDocument();
  });
});
