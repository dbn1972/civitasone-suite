import { NextIntlClientProvider } from "next-intl";
import { renderWithIntl } from "@/lib/testUtils/intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { DataQualityReport, DqRecord } from "@/lib/crm/dataQuality";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, getDataQuality: vi.fn() };
});

import { DataQualityView } from "./DataQualityView";
import { getDataQuality } from "@/lib/crm/dataQuality";

const mocked = vi.mocked(getDataQuality);

const NO_ROWS = { missing: [], invalid: [], stale: [] };

function report(overrides: Partial<DataQualityReport> = {}): DataQualityReport {
  const missing: DqRecord[] = [{ id: "r1", score: 0.5, issues: ["missing:email"] }];
  return {
    distribution: [
      { label: "Complete", count: 1123 },
      { label: "1 field missing", count: 96 },
      { label: "2 fields missing", count: 21 },
      { label: "3+ missing", count: 8 },
    ],
    counts: { missing: 125, invalid: 12, stale: 40 },
    records: [],
    recordsByFilter: { ...NO_ROWS, missing },
    ...overrides,
  };
}

const ui = () => (
  <NextIntlClientProvider locale="en" messages={enMessages}>
    <DataQualityView />
  </NextIntlClientProvider>
);

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

  it("GAP-CRM-DATA-QUALITY-03: switching the filter tab makes no request and never blanks the stat cards or distribution", async () => {
    mocked.mockResolvedValue({
      data: report({
        recordsByFilter: {
          missing: [{ id: "m1", score: 0.5, issues: ["missing:email"], name: "Missing Mina" }],
          invalid: [{ id: "i1", score: 0.9, issues: ["invalid:phone"], name: "Invalid Ira" }],
          stale: [{ id: "s1", score: 1, issues: ["stale"], name: "Stale Sam" }],
        },
      }),
      source: "api",
    });
    render(ui());

    await waitFor(() => expect(screen.getByText("125")).toBeInTheDocument());
    expect(screen.getByText("Missing Mina")).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledTimes(1);
    expect(mocked).toHaveBeenCalledWith("contacts", "all");

    fireEvent.click(screen.getByRole("tab", { name: "Invalid format" }));
    // The rows swap instantly, from the report already in hand...
    expect(screen.getByText("Invalid Ira")).toBeInTheDocument();
    expect(screen.queryByText("Missing Mina")).not.toBeInTheDocument();
    // ...while the stats and the distribution stay mounted (no "…", no blanking).
    expect(screen.getByText("125")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText(/1,123 \(90\.0%\)/)).toBeInTheDocument();
    expect(screen.queryByText("…")).not.toBeInTheDocument();
    expect(screen.queryByText(/loading records/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Stale records" }));
    expect(screen.getByText("Stale Sam")).toBeInTheDocument();

    // Not one extra request for any of the tab clicks.
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("GAP-CRM-DATA-QUALITY-06: shows definitions of the quality score and each filter", async () => {
    mocked.mockResolvedValue({ data: report(), source: "api" });
    renderWithIntl(<DataQualityView />);
    await waitFor(() => expect(screen.getByText(/Quality score is the share/)).toBeInTheDocument());
    expect(screen.getByText(/not updated within the office/)).toBeInTheDocument();
  });

  it("GAP-CRM-DATA-QUALITY-04: Leads and Contacts are one scope, and a flagged lead opens its contact record", async () => {
    mocked.mockResolvedValue({
      data: report({ recordsByFilter: { ...NO_ROWS, missing: [{ id: "lead-1", score: 0.5, issues: ["missing:email"], name: "Asha" }] } }),
      source: "api",
    });
    renderWithIntl(<DataQualityView />);

    await waitFor(() => expect(screen.getByText("Asha")).toBeInTheDocument());
    // One combined scope, not two selector entries that open the same records.
    expect(screen.getByRole("tab", { name: "Contacts & leads" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Leads" })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Contacts" })).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Asha" });
    expect(link).toHaveAttribute("href", "/crm/contacts/lead-1");
    // the title spells out it opens the contact record, not a phantom leads screen
    expect(link).toHaveAttribute("title", "Open contact record lead-1");
  });
});

describe("DataQualityView record naming (GAP-CRM-DATA-QUALITY-01)", () => {
  it("shows the record name as the link text and links to its detail, with no bare UUID on screen", async () => {
    mocked.mockResolvedValue({
      data: report({
        counts: { missing: 1, invalid: 0, stale: 0 },
        distribution: [],
        recordsByFilter: { ...NO_ROWS, missing: [{ id: "c-uuid-123", score: 0.4, issues: ["missing:email"], name: "Asha Verma" }] },
      }),
      source: "api",
    });
    render(ui());
    const link = await screen.findByRole("link", { name: "Asha Verma" });
    expect(link).toHaveAttribute("href", "/crm/contacts/c-uuid-123");
    // The id survives only as the link's hover title, never as visible text.
    expect(link).toHaveAttribute("title", expect.stringContaining("c-uuid-123"));
    expect(screen.queryByText("c-uuid-123")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "c-uuid-123" })).not.toBeInTheDocument();
  });

  it("falls back to 'Unnamed record' when the backend omits the name, still without printing the id", async () => {
    mocked.mockResolvedValue({
      data: report({
        counts: { missing: 1, invalid: 0, stale: 0 },
        distribution: [],
        recordsByFilter: { ...NO_ROWS, missing: [{ id: "c-uuid-456", score: 0.4, issues: [] }] },
      }),
      source: "api",
    });
    render(ui());
    expect(await screen.findByRole("link", { name: "Unnamed record" })).toBeInTheDocument();
    expect(screen.queryByText("c-uuid-456")).not.toBeInTheDocument();
  });

  it("renders issue codes as localised wording, not raw codes", async () => {
    mocked.mockResolvedValue({
      data: report({
        recordsByFilter: {
          ...NO_ROWS,
          missing: [{ id: "x", score: 0.2, issues: ["missing:leadSource", "invalid:gstin", "stale", "legacy free text"], name: "Row X" }],
        },
      }),
      source: "api",
    });
    render(ui());
    const row = (await screen.findByText("Row X")).closest("tr")!;
    expect(within(row).getByText("Missing Lead source, Invalid GSTIN, Not updated recently, legacy free text")).toBeInTheDocument();
    expect(within(row).queryByText(/missing:/)).not.toBeInTheDocument();
  });

  it("says when the list is capped instead of implying it is complete", async () => {
    mocked.mockResolvedValue({
      data: report({ counts: { missing: 600, invalid: 0, stale: 0 } }),
      source: "api",
    });
    render(ui());
    expect(await screen.findByText("Showing the first 1 of 600 flagged records.")).toBeInTheDocument();
  });

  it("does not claim a cap when every flagged record is listed", async () => {
    mocked.mockResolvedValue({
      data: report({ counts: { missing: 1, invalid: 0, stale: 0 } }),
      source: "api",
    });
    render(ui());
    await screen.findByRole("link", { name: "Unnamed record" });
    expect(screen.queryByText(/Showing the first/)).not.toBeInTheDocument();
  });
});

const okReport: dq.DataQualityReport = {
  distribution: [{ label: "80-100%", count: 10 }, { label: "0-40%", count: 2 }],
  counts: { missing: 5, invalid: 3, stale: 7 },
  records: [],
  recordsByFilter: { ...NO_ROWS, missing: [{ id: "c1", score: 0.4, issues: ["missing:email", "stale"] }] },
};

describe("DataQualityView (DQ-004)", () => {
  it("renders counts and records on a successful load", async () => {
    mocked.mockResolvedValue({ data: okReport, source: "api" });
    render(ui());
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    // Unnamed record: the link text is the localized fallback, href still the detail page.
    expect(screen.getByRole("link", { name: "Unnamed record" })).toHaveAttribute("href", "/crm/contacts/c1");
    expect(screen.getByText("Missing Email, Not updated recently")).toBeInTheDocument();
  });

  it("uses the source===error pattern: shows saved-info badge and never a fabricated 0", async () => {
    mocked.mockResolvedValue({
      data: { distribution: [], counts: { missing: 0, invalid: 0, stale: 0 }, records: [], recordsByFilter: NO_ROWS },
      source: "error",
    });
    render(ui());
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText(/records unavailable/i)).toBeInTheDocument();
  });

  it("GAP-CRM-DATA-QUALITY-03: a failed load shows '—' on every stat even after switching tabs, never zeros", async () => {
    mocked.mockResolvedValue({
      data: { distribution: [], counts: { missing: 0, invalid: 0, stale: 0 }, records: [], recordsByFilter: NO_ROWS },
      source: "error",
    });
    render(ui());
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("tab", { name: "Stale records" }));
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.getByText(/records unavailable/i)).toBeInTheDocument();
    expect(mocked).toHaveBeenCalledTimes(1);
  });

  it("fetches once per entity (all filters in one call) and reuses the cached report when going back", async () => {
    mocked.mockResolvedValue({ data: okReport, source: "api" });
    render(ui());
    await waitFor(() => expect(mocked).toHaveBeenCalledWith("contacts", "all"));

    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    await waitFor(() => expect(mocked).toHaveBeenCalledWith("accounts", "all"));
    fireEvent.click(screen.getByRole("tab", { name: "Stale records" }));
    expect(mocked).toHaveBeenCalledTimes(2);

    // Back to the first scope: served from the cache, no third request.
    fireEvent.click(screen.getByRole("tab", { name: "Contacts & leads" }));
    await waitFor(() => expect(screen.getByText("5")).toBeInTheDocument());
    expect(mocked).toHaveBeenCalledTimes(2);
  });

  it("an entity switch while a load is in flight ignores the stale response", async () => {
    let resolveFirst!: (v: { data: DataQualityReport; source: "api" }) => void;
    mocked.mockImplementationOnce(() => new Promise((r) => { resolveFirst = r; }));
    mocked.mockResolvedValueOnce({
      data: report({ counts: { missing: 777, invalid: 0, stale: 0 }, recordsByFilter: NO_ROWS }),
      source: "api",
    });
    render(ui());
    fireEvent.click(screen.getByRole("tab", { name: "Accounts" }));
    await waitFor(() => expect(screen.getByText("777")).toBeInTheDocument());

    resolveFirst({ data: report({ counts: { missing: 111, invalid: 0, stale: 0 } }), source: "api" });
    await Promise.resolve();
    expect(screen.queryByText("111")).not.toBeInTheDocument();
    expect(screen.getByText("777")).toBeInTheDocument();
  });
});
