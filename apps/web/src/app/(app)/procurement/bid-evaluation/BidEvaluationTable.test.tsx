import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { BidEvaluationTable } from "./BidEvaluationTable";
import type { BidEvaluation } from "../../../_data/loaders";

const mockedHook = vi.mocked(useSeededResource);

type Prov = "live" | "cached" | "error-no-data";

function seed(data: BidEvaluation[], provenance: Prov) {
  mockedHook.mockImplementation((() => ({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  })) as unknown as typeof useSeededResource);
}

const ROWS: BidEvaluation[] = [
  { id: "b1", tender: "TND-1", tenderId: "tid-1", bidder: "Acme", technicalScore: 82.5, financialScore: 70, totalScore: 76.25, rank: 1, status: "technically_qualified" },
  { id: "b2", tender: "TND-1", tenderId: "tid-1", bidder: "Beta", technicalScore: 60, financialScore: 80, totalScore: 70, rank: 2, status: "technically_qualified" },
  // Same bidder (Acme) in a second tender — must count as one bidder.
  { id: "b3", tender: "TND-2", tenderId: "tid-2", bidder: "Acme", technicalScore: 90, financialScore: 88, totalScore: 89, rank: 1, status: "awarded" },
];

describe("BidEvaluationTable", () => {
  beforeEach(() => mockedHook.mockReset());

  it("GAP-BID-04: formats scores with two decimals", () => {
    seed(ROWS, "live");
    render(<BidEvaluationTable evaluations={ROWS} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("82.50")).toBeInTheDocument();
    expect(within(table).getByText("76.25")).toBeInTheDocument();
  });

  it("GAP-BID-03: counts distinct bidders, not bid-tender pairs", () => {
    seed(ROWS, "live");
    render(<BidEvaluationTable evaluations={ROWS} source="api" />);
    // Acme appears in two tenders but is one bidder => 2 unique (Acme, Beta).
    expect(screen.getByText("Bidders").closest(".stat")).toHaveTextContent("2");
  });

  it("GAP-BID-03: 'Tenders under evaluation' excludes awarded/closed tenders", () => {
    seed(ROWS, "live");
    render(<BidEvaluationTable evaluations={ROWS} source="api" />);
    // TND-1 is under evaluation; TND-2 is awarded (closed) => 1.
    expect(screen.getByText("Tenders under evaluation").closest(".stat")).toHaveTextContent("1");
  });

  it("GAP-BID-04: marks L1 and ties on rank", () => {
    const tied: BidEvaluation[] = [
      { id: "t1", tender: "T", tenderId: "x", bidder: "A", technicalScore: 50, financialScore: 50, totalScore: 50, rank: 1, status: "technically_qualified" },
      { id: "t2", tender: "T", tenderId: "x", bidder: "B", technicalScore: 50, financialScore: 50, totalScore: 50, rank: 1, status: "technically_qualified" },
    ];
    seed(tied, "live");
    render(<BidEvaluationTable evaluations={tied} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("L1").length).toBe(2);
    expect(within(table).getAllByText("(tie)").length).toBe(2);
  });

  it("GAP-BID-04: a rank-1 bid in each of two tenders is NOT a tie (ranks are per tender)", () => {
    // ROWS has TND-1 (ranks 1, 2) and TND-2 (rank 1): two L1s, no tie anywhere.
    seed(ROWS, "live");
    render(<BidEvaluationTable evaluations={ROWS} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("L1").length).toBe(2);
    expect(within(table).queryByText("(tie)")).not.toBeInTheDocument();
  });

  it("GAP-BID-04: flags a tie only inside the tender that has it", () => {
    const mixed: BidEvaluation[] = [
      { id: "m1", tender: "TND-A", tenderId: "a", bidder: "A1", technicalScore: 50, financialScore: 50, totalScore: 50, rank: 1, status: "technically_qualified" },
      { id: "m2", tender: "TND-A", tenderId: "a", bidder: "A2", technicalScore: 50, financialScore: 50, totalScore: 50, rank: 1, status: "technically_qualified" },
      { id: "m3", tender: "TND-B", tenderId: "b", bidder: "B1", technicalScore: 70, financialScore: 70, totalScore: 70, rank: 1, status: "technically_qualified" },
    ];
    seed(mixed, "live");
    render(<BidEvaluationTable evaluations={mixed} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("L1").length).toBe(3);
    // Only TND-A's two bids carry the marker; TND-B's lone rank-1 bid does not.
    expect(within(table).getAllByText("(tie)").length).toBe(2);
    const b1Row = within(table).getByText("B1").closest("tr") as HTMLElement;
    expect(within(b1Row).queryByText("(tie)")).not.toBeInTheDocument();
  });

  it("GAP-BID-04: falls back to the tender ref when tenderId is missing, so different refs never tie", () => {
    const noIds: BidEvaluation[] = [
      { id: "k1", tender: "TND-X", bidder: "A", technicalScore: 1, financialScore: 1, totalScore: 1, rank: 1, status: "awarded" },
      { id: "k2", tender: "TND-Y", bidder: "B", technicalScore: 1, financialScore: 1, totalScore: 1, rank: 1, status: "awarded" },
      { id: "k3", tender: "TND-Z", bidder: "C", technicalScore: 1, financialScore: 1, totalScore: 1, rank: 1, status: "awarded" },
      { id: "k4", tender: "TND-Z", bidder: "D", technicalScore: 1, financialScore: 1, totalScore: 1, rank: 1, status: "awarded" },
    ];
    seed(noIds, "live");
    render(<BidEvaluationTable evaluations={noIds} source="api" />);
    expect(within(screen.getByRole("table")).getAllByText("(tie)").length).toBe(2); // C and D only
  });

  it("GAP-BID-04: an unranked bid (rank 0) shows a dash, never L1 or a tie", () => {
    const unranked: BidEvaluation[] = [
      { id: "u1", tender: "TND-U", tenderId: "u", bidder: "A", technicalScore: 80, financialScore: null, totalScore: 80, rank: 0, status: "technically_qualified" },
      { id: "u2", tender: "TND-U", tenderId: "u", bidder: "B", technicalScore: 75, financialScore: null, totalScore: 75, rank: 0, status: "technically_qualified" },
    ];
    seed(unranked, "live");
    render(<BidEvaluationTable evaluations={unranked} source="api" />);
    const table = screen.getByRole("table");
    expect(within(table).queryByText("L1")).not.toBeInTheDocument();
    expect(within(table).queryByText("(tie)")).not.toBeInTheDocument();
    expect(within(table).queryByText("0")).not.toBeInTheDocument();
  });

  it("GAP-BID-05: links the tender ref to the tender detail page when tenderId is present", () => {
    seed(ROWS, "live");
    render(<BidEvaluationTable evaluations={ROWS} source="api" />);
    const link = screen.getAllByRole("link", { name: "TND-1" })[0];
    expect(link).toHaveAttribute("href", "/procurement/tenders/tid-1");
  });

  it("GAP-BID-05: falls back to plain text when tenderId is missing", () => {
    const noId: BidEvaluation[] = [
      { id: "n1", tender: "TND-NOID", bidder: "A", technicalScore: 1, financialScore: 1, totalScore: 1, rank: 1, status: "submitted" },
    ];
    seed(noId, "live");
    render(<BidEvaluationTable evaluations={noId} source="api" />);
    expect(screen.queryByRole("link", { name: "TND-NOID" })).not.toBeInTheDocument();
    expect(screen.getByText("TND-NOID")).toBeInTheDocument();
  });

  it("GAP-BID-01/02: a failed load with no cache shows an ErrorState and '—' stats, not an empty 'all clear'", () => {
    seed([], "error-no-data");
    render(<BidEvaluationTable evaluations={[]} source="error" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText("No evaluations found")).not.toBeInTheDocument();
    expect(screen.getByText("Bidders").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Tenders under evaluation").closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-BID-01: a genuinely empty but healthy list shows the EmptyState", () => {
    seed([], "live");
    render(<BidEvaluationTable evaluations={[]} source="api" />);
    expect(screen.getByText("No evaluations found")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("Bidders").closest(".stat")).toHaveTextContent("0");
  });

  it("GAP-BID-06: withholds the financial score (renders '—') when the envelope is sealed (financialScore null)", () => {
    const sealed: BidEvaluation[] = [
      { id: "s1", tender: "T", tenderId: "x", bidder: "A", technicalScore: 80, financialScore: null, totalScore: 80, rank: 1, status: "technical_evaluation" },
    ];
    seed(sealed, "live");
    render(<BidEvaluationTable evaluations={sealed} source="api" />);
    const table = screen.getByRole("table");
    // Technical shown (80.00); total is technical-only, also 80.00.
    expect(within(table).getAllByText("80.00").length).toBeGreaterThan(0);
    // The financial cell renders the withheld dash.
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
  });

  it("GAP-BID-02: stats reflect cached rows, not the empty server list", () => {
    // Server list empty, but cache has rows (provenance 'cached'): stats must
    // reflect the 3 cached rows the table shows, not 0.
    seed(ROWS, "cached");
    render(<BidEvaluationTable evaluations={[]} source="error" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText("Acme").length).toBeGreaterThan(0);
    expect(screen.getByText("Bidders").closest(".stat")).toHaveTextContent("2");
  });
});
