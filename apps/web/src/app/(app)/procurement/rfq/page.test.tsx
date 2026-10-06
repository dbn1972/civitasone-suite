import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import RFQPage from "./page";
import type { RFQSummary } from "@civitasone/types";

// A fixed "today" so the overdue cue is deterministic regardless of run date.
const PAST = "2000-01-01";
const FUTURE = "2999-12-31";

function routeRFQs(rfqs: RFQSummary[], source: "api" | "error" = "api") {
  fetchJsonMock.mockImplementation((path: unknown, empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
    const mapped = options?.mapResponse ? options.mapResponse(rfqs) : rfqs;
    return Promise.resolve({ data: source === "error" ? empty : mapped, source });
  });
}

const BASE: RFQSummary = {
  id: "r1", rfqNo: "RFQ/2026/001", title: "Laptops",
  indentRef: "procurement_indent:ind-123", vendorsInvited: 3, responsesReceived: 2,
  closingDate: FUTURE, status: "issued",
};

describe("RFQPage (GAP-PROCUREMENT-RFQ-01/02/03/04)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("RFQ-01: no 'Templates' dead-end link remains", async () => {
    routeRFQs([BASE]);
    render(await RFQPage());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.includes("template=1"))).toBe(false);
    expect(screen.queryByText("Templates")).not.toBeInTheDocument();
  });

  it("RFQ-02: indent ref renders a link to /procurement/indents/<id>, never the raw ref", async () => {
    routeRFQs([BASE]);
    render(await RFQPage());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/procurement/indents/ind-123");
    expect(screen.queryByText(/procurement_indent:/)).not.toBeInTheDocument();
  });

  it("RFQ-02: an RFQ with no indent ref shows '—' and no indent link", async () => {
    routeRFQs([{ ...BASE, id: "r2", indentRef: undefined }]);
    render(await RFQPage());
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.startsWith("/procurement/indents/"))).toBe(false);
  });

  it("RFQ-04: the quotes tile is labelled 'Quotes received' (not the ambiguous 'Responses')", async () => {
    routeRFQs([BASE]);
    render(await RFQPage());
    expect(screen.getByText("Quotes received")).toBeInTheDocument();
  });

  it("RFQ-03: status filter hides non-matching rows", async () => {
    routeRFQs([
      BASE,
      { ...BASE, id: "r2", rfqNo: "RFQ/2026/002", title: "Chairs", status: "awarded" },
    ]);
    render(await RFQPage());
    expect(screen.getByText("Laptops")).toBeInTheDocument();
    expect(screen.getByText("Chairs")).toBeInTheDocument();
    // Click the "Awarded" segment -> only the awarded row remains.
    fireEvent.click(screen.getByRole("tab", { name: "Awarded" }));
    expect(screen.queryByText("Laptops")).not.toBeInTheDocument();
    expect(screen.getByText("Chairs")).toBeInTheDocument();
  });

  it("RFQ-03: an issued RFQ past its closing date with 0 responses shows an overdue/no-response cue", async () => {
    routeRFQs([{ ...BASE, closingDate: PAST, responsesReceived: 0 }]);
    render(await RFQPage());
    expect(screen.getByText(/Overdue · no responses/)).toBeInTheDocument();
  });

  it("RFQ-03: an issued RFQ closing in the future shows no overdue cue", async () => {
    routeRFQs([{ ...BASE, closingDate: FUTURE, responsesReceived: 0 }]);
    render(await RFQPage());
    expect(screen.queryByText(/Overdue/)).not.toBeInTheDocument();
  });

  it("RFQ-04: an awarded RFQ's status pill uses the 'good' tone", async () => {
    routeRFQs([{ ...BASE, status: "awarded" }]);
    render(await RFQPage());
    // Scope to the pill (the word also appears as a stat-tile label).
    const pill = Array.from(document.querySelectorAll("span.pill")).find((el) => el.textContent === "Awarded");
    expect(pill).toBeTruthy();
    expect(pill!.className).toContain("good");
  });
});
