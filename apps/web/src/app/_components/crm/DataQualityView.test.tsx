import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { DataQualityReport } from "@/lib/crm/dataQuality";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, getDataQuality: vi.fn() };
});

import { DataQualityView } from "./DataQualityView";
import { getDataQuality } from "@/lib/crm/dataQuality";

const mocked = vi.mocked(getDataQuality);

function report(overrides: Partial<DataQualityReport> = {}): DataQualityReport {
  return {
    distribution: [
      { label: "Complete", count: 1123 },
      { label: "1 field missing", count: 96 },
      { label: "2 fields missing", count: 21 },
      { label: "3+ missing", count: 8 },
    ],
    counts: { missing: 125, invalid: 12, stale: 40 },
    records: [{ id: "r1", score: 0.5, issues: ["email"] }],
    ...overrides,
  };
}

beforeEach(() => mocked.mockReset());

describe("DataQualityView", () => {
  it("GAP-CRM-DATA-QUALITY-02: distribution bars are a share of the total, with a percent label", async () => {
    mocked.mockResolvedValue({ data: report(), source: "api" });
    render(ui());

    // 1123 / (1123+96+21+8=1248) = ~90.0%
    await waitFor(() => expect(screen.getByText(/1,123 \(90\.0%\)/)).toBeInTheDocument());
    // the smallest bucket is still a readable, non-zero share, not flattened to ~0
    expect(screen.getByText(/8 \(0\.6%\)/)).toBeInTheDocument();
    // an accessible label carries the percentage
    expect(screen.getByLabelText(/Complete: 90\.0% of records/)).toBeInTheDocument();
  });

  it("GAP-CRM-DATA-QUALITY-02: a zero-total distribution renders no NaN", async () => {
    mocked.mockResolvedValue({
      data: report({ distribution: [{ label: "Complete", count: 0 }] }),
      source: "api",
    });
    render(ui());
    await waitFor(() => expect(screen.getByText(/0 \(0\.0%\)/)).toBeInTheDocument());
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("GAP-CRM-DATA-QUALITY-03: switching the filter tab does not blank the stat cards to '…'", async () => {
    mocked.mockResolvedValue({ data: report(), source: "api" });
    render(ui());

    await waitFor(() => expect(screen.getByText("125")).toBeInTheDocument());
    expect(mocked).toHaveBeenCalledTimes(1);

    // switch to the "Invalid format" filter tab
    fireEvent.click(screen.getByRole("tab", { name: "Invalid format" }));

    // stats stay mounted (no "…"), distribution stays visible
    expect(screen.getByText("125")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.queryByText("…")).not.toBeInTheDocument();
  });

  it("GAP-CRM-DATA-QUALITY-03: a records-only error on filter change keeps the cached stats", async () => {
    mocked.mockResolvedValueOnce({ data: report(), source: "api" });
    render(ui());
    await waitFor(() => expect(screen.getByText("125")).toBeInTheDocument());

    mocked.mockResolvedValueOnce({
      data: { distribution: [], counts: { missing: 0, invalid: 0, stale: 0 }, records: [] },
      source: "error",
    });
    fireEvent.click(screen.getByRole("tab", { name: "Stale records" }));

    // the summary stays (not reset to 0 or "—") because only records failed
    await waitFor(() => expect(screen.getByText("125")).toBeInTheDocument());
  });
});


describe("DataQualityView record naming (GAP-CRM-DATA-QUALITY-01)", () => {
  it("shows the record name as the link text (not the bare UUID) and links to its detail", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({
      data: {
        distribution: [],
        counts: { missing: 1, invalid: 0, stale: 0 },
        records: [{ id: "c-uuid-123", score: 0.4, issues: ["no email"], name: "Asha Verma" }],
      },
      source: "api",
    });
    render(ui());
    const link = await screen.findByRole("link", { name: "Asha Verma" });
    expect(link).toHaveAttribute("href", "/crm/contacts/c-uuid-123");
    // The UUID is still available but only as muted secondary text / title,
    // never the link label itself.
    expect(screen.queryByRole("link", { name: "c-uuid-123" })).not.toBeInTheDocument();
  });

  it("falls back to 'Unnamed record' when the backend omits the name", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({
      data: {
        distribution: [],
        counts: { missing: 1, invalid: 0, stale: 0 },
        records: [{ id: "c-uuid-456", score: 0.4, issues: [] }],
      },
      source: "api",
    });
    render(ui());
    expect(await screen.findByRole("link", { name: "Unnamed record" })).toBeInTheDocument();
  });
});

const okReport: dq.DataQualityReport = {
  distribution: [{ label: "80-100%", count: 10 }, { label: "0-40%", count: 2 }],
  counts: { missing: 5, invalid: 3, stale: 7 },
  records: [{ id: "c1", score: 0.4, issues: ["no email", "stale"] }],
};
const ui = () => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <DataQualityView />
  </NextIntlClientProvider>
);

describe("DataQualityView (DQ-004)", () => {
  it("renders counts and records on a successful load", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({ data: okReport, source: "api" });
    render(ui());
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    // Unnamed record: the link text is the localized fallback, href still the detail page.
    expect(screen.getByRole("link", { name: "Unnamed record" })).toHaveAttribute("href", "/crm/contacts/c1");
    expect(screen.getByText(/no email, stale/i)).toBeInTheDocument();
  });

  it("uses the source===error pattern: shows saved-info badge and never a fabricated 0", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({
      data: { distribution: [], counts: { missing: 0, invalid: 0, stale: 0 }, records: [] },
      source: "error",
    });
    render(ui());
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText(/records unavailable/i)).toBeInTheDocument();
  });

  it("re-fetches when entity and filter change", async () => {
    vi.mocked(dq.getDataQuality).mockResolvedValue({ data: okReport, source: "api" });
    render(ui());
    await waitFor(() => expect(dq.getDataQuality).toHaveBeenCalledWith("contacts", "missing"));
    fireEvent.click(screen.getByText("Accounts"));
    await waitFor(() => expect(dq.getDataQuality).toHaveBeenCalledWith("accounts", "missing"));
    fireEvent.click(screen.getByRole("tab", { name: "Stale records" }));
    await waitFor(() => expect(dq.getDataQuality).toHaveBeenCalledWith("accounts", "stale"));
  });
});
