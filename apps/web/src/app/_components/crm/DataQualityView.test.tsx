import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DataQualityView } from "./DataQualityView";
import * as dq from "@/lib/crm/dataQuality";

vi.mock("@/lib/crm/dataQuality", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/dataQuality")>();
  return { ...actual, getDataQuality: vi.fn() };
});

beforeEach(() => vi.mocked(dq.getDataQuality).mockReset());

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
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DataQualityView /></NextIntlClientProvider>);
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
    render(<NextIntlClientProvider locale="en" messages={enMessages}><DataQualityView /></NextIntlClientProvider>);
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
