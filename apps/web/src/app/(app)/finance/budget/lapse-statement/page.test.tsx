import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const fetchJsonMock = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...a: unknown[]) => fetchJsonMock(...a),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("../../_components/PrintExportButton", () => ({ PrintExportButton: () => null }));

import LapseStatementPage from "./page";
import { mapLapseStatement } from "./lapseStatement";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const BODY = {
  fiscalYear: "2025-26",
  recorded: null,
  rows: [
    { headId: "h1", headCode: "2202", headName: "General Education", beMinor: "10000000", reMinor: "12000000", reappropriationNetMinor: "2000000", expenditureMinor: "11000000", lapseMinor: "1000000", excessMinor: "0" },
    { headId: "h2", headCode: "2210", headName: "Medical", beMinor: "5000000", reMinor: "5000000", reappropriationNetMinor: "0", expenditureMinor: "5500000", lapseMinor: "0", excessMinor: "500000" },
  ],
  totals: { beMinor: "15000000", reMinor: "17000000", expenditureMinor: "16500000", lapseMinor: "1000000", excessMinor: "500000" },
};

/** The loader maps the body exactly as production does (mapResponse), then the page renders it. */
function respond(body: unknown, source: "api" | "error" = "api", status?: number) {
  fetchJsonMock.mockImplementation(async (...a: unknown[]) => {
    const opts = a[2] as { mapResponse?: (p: unknown) => unknown } | undefined;
    if (source === "error") return { data: a[1] ?? null, source, status };
    return { data: opts?.mapResponse ? opts.mapResponse(body) : mapLapseStatement(body), source };
  });
}

describe("LapseStatementPage (fx-p3)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("asks for the selected FY and shows the title, the GFR note and a provisional status", async () => {
    respond(BODY);
    render(await LapseStatementPage({ searchParams: Promise.resolve({ fy: "2025-26" }) }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toBe("/api/v1/finance/budgets/lapse-statement?fy=2025-26");
    expect(screen.getAllByText("Lapse statement (31 March)").length).toBeGreaterThan(0);
    expect(screen.getByText("Unspent provision lapses on 31 March and is not carried forward (GFR).")).toBeInTheDocument();
    expect(screen.getByText(/Provisional: the year-end close has not recorded the statement for FY 2025-26/)).toBeInTheDocument();
  });

  it("has a captioned table with the documented column headers, exact money and a totals row", async () => {
    respond(BODY);
    render(await LapseStatementPage({ searchParams: Promise.resolve({ fy: "2025-26" }) }));
    const table = screen.getByRole("table");
    expect(table.querySelector("caption")?.textContent).toMatch(/Lapse statement for FY 2025-26/);
    const headers = within(table).getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).toEqual([
      "Head", "Budget estimate", "Re-appropriation / supplementary (net)", "Final grant", "Expenditure", "Unspent (lapses)", "Excess",
    ]);
    const row = screen.getByText("2202 · General Education").closest("tr")!;
    expect(Array.from(row.querySelectorAll("td")).map((c) => c.textContent)).toEqual([
      "2202 · General Education", "₹1,00,000.00", "₹20,000.00", "₹1,20,000.00", "₹1,10,000.00", "₹10,000.00", "₹0.00",
    ]);
    const total = screen.getByText("Total").closest("tr")!;
    expect(Array.from(total.querySelectorAll("td")).map((c) => c.textContent)).toEqual([
      "Total", "₹1,50,000.00", "₹20,000.00", "₹1,70,000.00", "₹1,65,000.00", "₹10,000.00", "₹5,000.00",
    ]);
    // the totals row is last
    const rows = within(table).getAllByRole("row");
    expect(rows.at(-1)).toBe(total);
  });

  it("a recorded statement says who recorded it and when", async () => {
    respond({ ...BODY, recorded: { recordedAt: "2026-04-01T04:30:00.000Z", recordedBy: "11111111-1111-4111-8111-111111111111", recordedByName: "Asha Rao" } });
    render(await LapseStatementPage({ searchParams: Promise.resolve({ fy: "2025-26" }) }));
    expect(screen.getByText(/Recorded at year-end for FY 2025-26 on 01 Apr 2026, 10:00 am by Asha Rao\./i)).toBeInTheDocument();
    expect(screen.queryByText(/Provisional/)).not.toBeInTheDocument();
  });

  it("an empty year is an empty state, with no totals row", async () => {
    respond({ fiscalYear: "2025-26", recorded: null, rows: [], totals: { beMinor: "0", reMinor: "0", expenditureMinor: "0", lapseMinor: "0", excessMinor: "0" } });
    render(await LapseStatementPage({ searchParams: Promise.resolve({ fy: "2025-26" }) }));
    expect(screen.getByText("No budget provision for this year")).toBeInTheDocument();
    expect(screen.queryByText("Total")).not.toBeInTheDocument();
  });

  it("a failed load is an error state, never an empty statement", async () => {
    respond(null, "error", 503);
    render(await LapseStatementPage({ searchParams: Promise.resolve({ fy: "2025-26" }) }));
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText("No budget provision for this year")).not.toBeInTheDocument();
    expect(screen.queryByText(/Provisional/)).not.toBeInTheDocument();
  });

  it("a malformed ?fy= falls back to a valid FY", async () => {
    respond(BODY);
    render(await LapseStatementPage({ searchParams: Promise.resolve({ fy: "2025-99" }) }));
    expect(String(fetchJsonMock.mock.calls[0]![0])).toMatch(/fy=\d{4}-\d{2}$/);
    expect(String(fetchJsonMock.mock.calls[0]![0])).not.toContain("2025-99");
  });

  it("every label has a Hindi translation", () => {
    const en = (enMessages as unknown as Record<string, Record<string, string>>).financeLapseStatement!;
    const hi = (hiMessages as unknown as Record<string, Record<string, string>>).financeLapseStatement!;
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    for (const k of Object.keys(en)) expect(hi[k], k).not.toBe(en[k]);
  });
});
