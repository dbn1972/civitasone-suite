import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import TendersPage from "./page";

const YESTERDAY = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const TOMORROW = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);

const TENDERS = [
  { id: "t1", tenderNo: "T-1", title: "Laptops", type: "single_source", estimatedValue: 400000, bidClosingDate: TOMORROW, status: "draft", bidsReceived: 0 },
  { id: "t2", tenderNo: "T-2", title: "Printers", type: "open", estimatedValue: 100000, bidClosingDate: YESTERDAY, status: "published", bidsReceived: 0 },
  { id: "t3", tenderNo: "T-3", title: "Desks", type: "limited", estimatedValue: 50000, bidClosingDate: TOMORROW, status: "technical_evaluation", bidsReceived: 3 },
  { id: "t4", tenderNo: "T-4", title: "Chairs", type: "gem", estimatedValue: 20000, bidClosingDate: TOMORROW, status: "financial_evaluation", bidsReceived: 2 },
];

function route(data: unknown, source: "api" | "error" = "api") {
  fetchJsonMock.mockImplementation((_p: unknown, _empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
    const mapped = options?.mapResponse ? options.mapResponse({ data }) : data;
    return Promise.resolve({ data: source === "error" ? [] : mapped, source });
  });
}

describe("TendersPage (GAP-PROCUREMENT-TENDERS-01/02/03/04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("TENDERS-01: subtitle names single-source; a single_source row shows a warn 'Single Source' pill", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText(/single-source/i)).toBeInTheDocument();
    const pill = screen.getAllByText("Single Source").find((el) => el.classList.contains("pill"));
    expect(pill).toBeDefined();
    expect(pill).toHaveClass("warn");
  });

  it("TENDERS-02: Technical Eval and Financial Eval are counted on separate tiles", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("Technical Eval").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Financial Eval").closest(".stat")).toHaveTextContent("1");
  });

  it("TENDERS-01/04: stat tiles are links to filtered views", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    const singleTile = screen.getAllByText("Single Source").map((el) => el.closest("a.stat")).find(Boolean);
    expect(singleTile).toHaveAttribute("href", expect.stringContaining("type=single_source"));
    const published = screen.getAllByText("Published").map((el) => el.closest("a.stat")).find(Boolean);
    expect(published).toHaveAttribute("href", expect.stringContaining("status=published"));
  });

  // UAT Phase 1B review: the cue no longer claims "0 bids" from the unmaintained bidsReceived
  // counter; a published tender past its close is flagged as closed with bids not yet opened.
  it("TENDERS-03: a published tender past its close shows the 'Closed — bids not yet opened' cue", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    const cue = screen.getByText("Closed — bids not yet opened");
    expect(cue).toHaveClass("pill", "bad");
    expect(screen.queryByText("Closed — 0 bids")).not.toBeInTheDocument();
  });

  it("the Bids column shows — (not the stale counter) with a note pointing to the tender page", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    const desks = screen.getByText("Desks").closest("tr")!;
    // t3 carries bidsReceived: 3 from the unmaintained counter; the register must not show it.
    const cells = Array.from(desks.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cells).toContain("—");
    expect(cells).not.toContain("3");
    expect(screen.getByRole("note")).toHaveTextContent(/number of bids is shown on each tender's page/);
  });

  it("TENDERS-03: a Type filter reduces the rows", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: Promise.resolve({ type: "single_source" }) }));
    expect(screen.getByText("Laptops")).toBeInTheDocument();
    expect(screen.queryByText("Printers")).not.toBeInTheDocument();
    expect(screen.queryByText("Desks")).not.toBeInTheDocument();
  });

  it("TENDERS-03: a Status filter reduces the rows", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: Promise.resolve({ status: "financial_evaluation" }) }));
    expect(screen.getByText("Chairs")).toBeInTheDocument();
    expect(screen.queryByText("Laptops")).not.toBeInTheDocument();
  });

  // UAT Phase 2 C4 (recon D22): drafts and awarded tenders read "Open" in the Bid Window column.
  it("C4: the bid window is 'Not yet published' for a draft and 'Closed' for an awarded tender, never 'Open'", async () => {
    route([
      { id: "d1", tenderNo: "T-D", title: "Draft one", type: "limited", estimatedValue: 1, bidClosingDate: TOMORROW, status: "draft", bidsReceived: 0, bidCount: 0 },
      { id: "a1", tenderNo: "T-A", title: "Awarded one", type: "limited", estimatedValue: 1, bidClosingDate: YESTERDAY, status: "awarded", bidsReceived: 0, bidCount: 2 },
      { id: "p1", tenderNo: "T-P", title: "Live one", type: "limited", estimatedValue: 1, bidClosingDate: TOMORROW, status: "published", bidsReceived: 0, bidCount: 1 },
    ]);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    const cells = (title: string) => Array.from(screen.getByText(title).closest("tr")!.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cells("Draft one")).toContain("Not yet published");
    expect(cells("Draft one")).not.toContain("Open");
    expect(cells("Awarded one")).toContain("Closed");
    expect(cells("Awarded one")).not.toContain("Open");
    expect(cells("Live one")).toContain("Open");
  });

  it("C4: the Bids column shows the real bid count from the API and drops the '—' note", async () => {
    route([
      { id: "a1", tenderNo: "T-A", title: "Awarded one", type: "limited", estimatedValue: 1, bidClosingDate: YESTERDAY, status: "awarded", bidsReceived: 0, bidCount: 3 },
    ]);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    const cells = Array.from(screen.getByText("Awarded one").closest("tr")!.querySelectorAll("td")).map((td) => td.textContent?.trim());
    expect(cells).toContain("3");
    expect(screen.queryByRole("note")).toBeNull();
  });

  // UAT Phase 1B (recon D06): estimatedValue is RUPEES on the wire; it must not be divided by 100 again.
  it("shows Est. Value in rupees as sent by the API", async () => {
    route([{ id: "t9", tenderNo: "TND/2026/0006", title: "Big", type: "open", estimatedValue: 5000000, bidClosingDate: TOMORROW, status: "draft", bidsReceived: 0 }]);
    render(await TendersPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getAllByText("₹50,00,000.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("₹50,000.00")).not.toBeInTheDocument();
  });
});

