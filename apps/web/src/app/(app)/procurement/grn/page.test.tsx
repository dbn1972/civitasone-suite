import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import GRNPage from "./page";

type Cfg = { list?: unknown[]; summary?: Record<string, number> | null; matched?: Record<string, number>; listError?: boolean };
const paths: string[] = [];

function route(cfg: Cfg) {
  paths.length = 0;
  fetchJsonMock.mockImplementation(
    (path: unknown, empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
      const p = String(path);
      paths.push(p);
      if (p.includes("/grns/summary")) {
        const body = p.includes("q=") ? cfg.matched : cfg.summary;
        const mapped = body ? options?.mapResponse?.({ data: body }) : null;
        return Promise.resolve({ data: mapped ?? null, source: body ? "api" : "error" });
      }
      if (cfg.listError) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: options?.mapResponse?.(cfg.list ?? []) ?? empty, source: "api" });
    },
  );
}

const grn = (i: number) => ({ id: `g${i}`, grnNo: `GRN-${i}`, poRef: "procurement_po:p", vendor: "Acme", receivedDate: "2026-09-01", receivedBy: "u", itemCount: 1, totalValue: 0, status: "accepted" });
// Scope to the stat tiles: the table's status cells also read "Accepted" / "Rejected".
const stat = (label: string) => {
  const lab = Array.from(document.querySelectorAll(".stat .lab")).find((el) => el.textContent === label);
  if (!lab) throw new Error(`no stat tile labelled ${label}`);
  return lab.closest(".stat") as HTMLElement;
};

describe("GRN register - GAP-PROCUREMENT-GRN-02", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("stat cards show the server's TRUE totals, not the size of the fetched page", async () => {
    route({ list: [grn(1), grn(2)], summary: { total: 700, accepted: 500, awaitingInspection: 150, rejected: 50 } });
    render(await GRNPage({ searchParams: Promise.resolve({}) }));
    expect(stat("Total GRNs")).toHaveTextContent("700");
    expect(stat("Accepted")).toHaveTextContent("500");
    expect(stat("Awaiting inspection")).toHaveTextContent("150");
    expect(stat("Rejected")).toHaveTextContent("50");
  });

  it("fetches one page from the server with limit/offset taken from ?page=", async () => {
    route({ list: [grn(1)], summary: { total: 60, accepted: 1, awaitingInspection: 0, rejected: 0 } });
    render(await GRNPage({ searchParams: Promise.resolve({ page: "3" }) }));
    expect(paths.find((p) => p.startsWith("/api/v1/procurement/grns?"))).toContain("offset=50");
    expect(paths.find((p) => p.startsWith("/api/v1/procurement/grns?"))).toContain("limit=25");
  });

  it("sends the search term to the server (a GRN outside the first page is findable) and shows the match count", async () => {
    route({ list: [grn(9)], summary: { total: 700, accepted: 500, awaitingInspection: 150, rejected: 50 }, matched: { total: 1, accepted: 1, awaitingInspection: 0, rejected: 0 } });
    render(await GRNPage({ searchParams: Promise.resolve({ q: "GRN-9" }) }));
    expect(paths.find((p) => p.startsWith("/api/v1/procurement/grns?"))).toContain("q=GRN-9");
    expect(screen.getByRole("status")).toHaveTextContent("1 GRN matches");
    // The cards still describe the whole store.
    expect(stat("Total GRNs")).toHaveTextContent("700");
  });

  it("a search with no match says so (distinct from an empty store) and offers to clear it", async () => {
    route({ list: [], summary: { total: 5, accepted: 5, awaitingInspection: 0, rejected: 0 }, matched: { total: 0, accepted: 0, awaitingInspection: 0, rejected: 0 } });
    render(await GRNPage({ searchParams: Promise.resolve({ q: "nothing" }) }));
    expect(screen.getByText("No GRNs match your search")).toBeInTheDocument();
    expect(screen.queryByText("No goods received yet")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Clear search" }).length).toBeGreaterThan(0);
  });

  it("offers Next only while the server total says more rows remain", async () => {
    route({ list: Array.from({ length: 25 }, (_, i) => grn(i)), summary: { total: 60, accepted: 25, awaitingInspection: 0, rejected: 0 } });
    const first = render(await GRNPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/procurement/grn?page=2");
    first.unmount();
    route({ list: Array.from({ length: 10 }, (_, i) => grn(i)), summary: { total: 60, accepted: 10, awaitingInspection: 0, rejected: 0 } });
    render(await GRNPage({ searchParams: Promise.resolve({ page: "3" }) }));
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/procurement/grn?page=2");
  });

  it("on a failed list load the cards read dash (not 0) and a retry is offered", async () => {
    route({ listError: true, summary: { total: 9, accepted: 9, awaitingInspection: 0, rejected: 0 } });
    render(await GRNPage({ searchParams: Promise.resolve({}) }));
    expect(stat("Total GRNs")).toHaveTextContent("—");
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  it("when only the summary fails the cards read dash, never a fabricated 0", async () => {
    route({ list: [grn(1)], summary: null });
    render(await GRNPage({ searchParams: Promise.resolve({}) }));
    expect(stat("Total GRNs")).toHaveTextContent("—");
    expect(stat("Accepted")).toHaveTextContent("—");
  });
});
