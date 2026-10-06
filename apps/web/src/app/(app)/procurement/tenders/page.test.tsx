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
    render(await TendersPage({ searchParams: {} }));
    expect(screen.getByText(/single-source/i)).toBeInTheDocument();
    const pill = screen.getAllByText("Single Source").find((el) => el.classList.contains("pill"));
    expect(pill).toBeDefined();
    expect(pill).toHaveClass("warn");
  });

  it("TENDERS-02: Technical Eval and Financial Eval are counted on separate tiles", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: {} }));
    expect(screen.getByText("Technical Eval").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Financial Eval").closest(".stat")).toHaveTextContent("1");
  });

  it("TENDERS-01/04: stat tiles are links to filtered views", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: {} }));
    const singleTile = screen.getAllByText("Single Source").map((el) => el.closest("a.stat")).find(Boolean);
    expect(singleTile).toHaveAttribute("href", expect.stringContaining("type=single_source"));
    const published = screen.getAllByText("Published").map((el) => el.closest("a.stat")).find(Boolean);
    expect(published).toHaveAttribute("href", expect.stringContaining("status=published"));
  });

  it("TENDERS-03: a published tender past its close with 0 bids shows the 'Closed — 0 bids' cue", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: {} }));
    const cue = screen.getByText("Closed — 0 bids");
    expect(cue).toHaveClass("pill", "bad");
  });

  it("TENDERS-03: a Type filter reduces the rows", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: { type: "single_source" } }));
    expect(screen.getByText("Laptops")).toBeInTheDocument();
    expect(screen.queryByText("Printers")).not.toBeInTheDocument();
    expect(screen.queryByText("Desks")).not.toBeInTheDocument();
  });

  it("TENDERS-03: a Status filter reduces the rows", async () => {
    route(TENDERS);
    render(await TendersPage({ searchParams: { status: "financial_evaluation" } }));
    expect(screen.getByText("Chairs")).toBeInTheDocument();
    expect(screen.queryByText("Laptops")).not.toBeInTheDocument();
  });
});
