import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const getLegalOpinionsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getLegalOpinions: () => getLegalOpinionsMock() }));

const resourceMock = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => resourceMock(...a) }));

import LegalOpinionsPage from "./page";

type Row = Record<string, unknown>;
function mock(items: Row[]) {
  getLegalOpinionsMock.mockResolvedValue({ data: items, source: "api" });
  resourceMock.mockReturnValue({ data: items, provenance: "live", offline: false, cachedAt: null, fromCache: false });
}
const statValue = (label: string) =>
  screen.getAllByText(label).find((el) => el.classList.contains("lab"))?.parentElement?.querySelector(".val")?.textContent;

describe("LegalOpinionsPage (GAP-LEGAL-OPINIONS-01 / OPINIONS-03)", () => {
  beforeEach(() => {
    getLegalOpinionsMock.mockReset();
    resourceMock.mockReset();
  });

  // GAP-LEGAL-OPINIONS-01: no fabricated "6.2 d" TAT; computed from real data.
  it("computes Avg TAT from issued opinions (4d and 6d -> 5 d)", async () => {
    mock([
      { id: "a", opinionNo: "A", subject: "s", requestedBy: "x", requestDate: "2026-09-01", issuedDate: "2026-09-05", status: "issued" },
      { id: "b", opinionNo: "B", subject: "s", requestedBy: "x", requestDate: "2026-09-01", issuedDate: "2026-09-07", status: "issued" },
    ]);
    render(await LegalOpinionsPage());
    expect(statValue("Avg TAT")).toBe("5 d");
    expect(screen.queryByText("6.2 d")).not.toBeInTheDocument();
  });

  it("shows '—' for Avg TAT when there are no issued opinions", async () => {
    mock([{ id: "a", opinionNo: "A", subject: "s", requestedBy: "x", requestDate: "2026-09-01", status: "pending" }]);
    render(await LegalOpinionsPage());
    expect(statValue("Avg TAT")).toBe("—");
  });

  // GAP-LEGAL-OPINIONS-03: card relabelled from "Precedents Tagged" to "Issued".
  it("labels the issued-count card 'Issued', not 'Precedents Tagged'", async () => {
    mock([{ id: "a", opinionNo: "A", subject: "s", requestedBy: "x", requestDate: "2026-09-01", issuedDate: "2026-09-05", status: "issued" }]);
    render(await LegalOpinionsPage());
    expect(statValue("Issued")).toBe("1");
    expect(screen.queryByText("Precedents Tagged")).not.toBeInTheDocument();
  });

  // GAP-LEGAL-OPINIONS-03: no dead "Search precedents" placeholder button.
  it("does not render a disabled 'Search precedents' control", async () => {
    mock([]);
    render(await LegalOpinionsPage());
    expect(screen.queryByText(/Search precedents/i)).not.toBeInTheDocument();
  });
});
