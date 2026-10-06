import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { PreBidTable } from "./PreBidTable";
import type { PreBidConference } from "../../../_data/loaders";

const mockedHook = vi.mocked(useSeededResource);

type Prov = "live" | "cached" | "error-no-data";
function seed(data: PreBidConference[], provenance: Prov) {
  mockedHook.mockReturnValue({
    data,
    provenance,
    offline: false,
    cachedAt: provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
    fromCache: provenance === "cached",
  } as unknown as ReturnType<typeof useSeededResource>);
}

const TID1 = "11111111-1111-4000-8000-000000000001";

const ROWS: PreBidConference[] = [
  // lower-case "completed" must still count as Held (GAP-PRE-BID-03).
  { id: TID1, tenderId: TID1, tender: "TND-001", date: "2026-05-01", queriesRaised: 5, responses: 2, openQueries: 3, attendees: 0, status: "completed" },
  { id: "t2", tenderId: "t2", tender: "TND-002", date: "2026-05-02", queriesRaised: 1, responses: 1, openQueries: 0, attendees: 0, status: "pending" },
];

describe("PreBidTable (GAP-PROCUREMENT-PRE-BID-01/02/03)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("counts lower-case 'completed' as Conferences Held and shows an Open queries tile", () => {
    seed(ROWS, "live");
    render(<PreBidTable conferences={ROWS} source="api" />);
    expect(screen.getByText("Conferences Held").closest(".stat")).toHaveTextContent("1");
    // Open queries = (5-2) + (1-1) = 3.
    expect(screen.getByText("Open queries").closest(".stat")).toHaveTextContent("3");
    expect(screen.getByText("Responses given").closest(".stat")).toHaveTextContent("3");
  });

  it("links the tender cell to the tender detail", () => {
    seed(ROWS, "live");
    render(<PreBidTable conferences={ROWS} source="api" />);
    const link = screen.getByRole("link", { name: /Open TND-001/i });
    expect(link).toHaveAttribute("href", `/procurement/tenders/${TID1}`);
  });

  it("on error with no cache shows a retry error and '—' stats, never 'No conferences found'", () => {
    seed([], "error-no-data");
    render(<PreBidTable conferences={[]} source="error" />);
    expect(screen.queryByText(/No conferences found/i)).not.toBeInTheDocument();
    expect(screen.getByText("Open queries").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("on a genuine empty api result shows the real empty state with 0 stats", () => {
    seed([], "live");
    render(<PreBidTable conferences={[]} source="api" />);
    expect(screen.getByText(/No conferences found/i)).toBeInTheDocument();
    expect(screen.getByText("Open queries").closest(".stat")).toHaveTextContent("0");
  });
});
