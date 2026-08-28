import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DataQualityView } from "./DataQualityView";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, getDataQuality: vi.fn() };
});

const okReport: dq.DataQualityReport = {
  distribution: [{ label: "80-100%", count: 10 }, { label: "0-40%", count: 2 }],
  counts: { missing: 5, invalid: 3, stale: 7 },
  records: [{ id: "c1", score: 0.4, issues: ["no email", "stale"] }],
};

beforeEach(() => vi.mocked(dq.getDataQuality).mockReset());

describe("DataQualityView (DQ-004)", () => {
  it("renders counts and records on a successful load", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({ data: okReport, source: "api" });
    render(<DataQualityView />);
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "c1" })).toHaveAttribute("href", "/crm/contacts/c1");
    expect(screen.getByText(/no email, stale/i)).toBeInTheDocument();
  });

  it("uses the source===error pattern: shows saved-info badge and — never a fabricated 0", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({
      data: { distribution: [], counts: { missing: 0, invalid: 0, stale: 0 }, records: [] },
      source: "error",
    });
    render(<DataQualityView />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
    // stat tiles show em dash, not "0"
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByText(/records unavailable/i)).toBeInTheDocument();
  });

  it("re-fetches when entity and filter change", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({ data: okReport, source: "api" });
    render(<DataQualityView />);
    await waitFor(() => expect(dq.getDataQuality).toHaveBeenCalledWith("contacts", "missing"));
    fireEvent.click(screen.getByText("Accounts"));
    await waitFor(() => expect(dq.getDataQuality).toHaveBeenCalledWith("accounts", "missing"));
    fireEvent.click(screen.getByRole("tab", { name: "Stale records" }));
    await waitFor(() => expect(dq.getDataQuality).toHaveBeenCalledWith("accounts", "stale"));
  });
});
