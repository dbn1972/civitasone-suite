import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import InstalmentsPage from "./page";

const assesseesPage = {
  data: [{ id: "a1", ownerName: "Ravi Kumar", identifierNo: "P-001", assesseeType: "property" }],
  source: "api" as const,
};

describe("InstalmentsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts to choose an assessee when none is selected", async () => {
    fetchJsonMock.mockResolvedValueOnce(assesseesPage);

    const ui = await InstalmentsPage({ searchParams: Promise.resolve({}) });
    render(ui);

    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders instalment plans with per-instalment amount and a detail link (GAP-REVENUE-INSTALMENTS-02/04)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/instalments")) {
        return Promise.resolve({
          data: [{ id: "p1", totalMinor: "1200000", instalmentCount: 6, startDate: "2026-04-01", status: "active" }],
          source: "api",
        });
      }
      if (path.includes("/dcb")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve(assesseesPage);
    });

    const ui = await InstalmentsPage({ searchParams: Promise.resolve({ assesseeId: "a1" }) });
    render(ui);

    expect(screen.getByText("6")).toBeInTheDocument();
    // Per-instalment: ₹12,000.00 / 6 = ₹2,000.00
    expect(screen.getByText("₹2,000.00")).toBeInTheDocument();
    // Row links to the plan detail.
    const links = screen.getAllByRole("link");
    expect(links.some((l) => l.getAttribute("href") === "/revenue/instalments/p1")).toBe(true);
  });

  it("passes the service DCB outstanding (not a sum of demand nets) to the plan form", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/instalments")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/dcb")) return Promise.resolve({ data: "750000", source: "api" });
      return Promise.resolve(assesseesPage);
    });

    const ui = await InstalmentsPage({ searchParams: Promise.resolve({ assesseeId: "a1" }) });
    render(ui);

    expect(fetchJsonMock.mock.calls.some((c) => String(c[0]).endsWith("/api/v1/revenue/assessees/a1/dcb"))).toBe(true);
    expect(fetchJsonMock.mock.calls.some((c) => String(c[0]).includes("/demands"))).toBe(false);
    expect(screen.getByText(/Outstanding arrears: ₹7,500\.00/)).toBeInTheDocument();
  });

  it("renders an empty state when there are no instalment plans", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/instalments")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/dcb")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve(assesseesPage);
    });

    const ui = await InstalmentsPage({ searchParams: Promise.resolve({ assesseeId: "a1" }) });
    render(ui);

    expect(screen.getByText("No instalment plans yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when a loader falls back on error", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/instalments")) return Promise.resolve({ data: [], source: "error" });
      if (path.includes("/dcb")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve(assesseesPage);
    });

    const ui = await InstalmentsPage({ searchParams: Promise.resolve({ assesseeId: "a1" }) });
    render(ui);

    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });

  // Owner decision #3: a second officer must be able to DISCOVER plans awaiting approval.
  it("lists plans awaiting approval across assessees with a link to decide (owner decision #3)", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("status=pending")) {
        return Promise.resolve({
          data: [{ id: "pp1", totalMinor: "900000", instalmentCount: 3, startDate: "2026-12-01", status: "pending" }],
          source: "api",
        });
      }
      return Promise.resolve(assesseesPage);
    });
    const ui = await InstalmentsPage({ searchParams: Promise.resolve({}) });
    render(ui);
    expect(screen.getByText("Awaiting approval")).toBeInTheDocument();
    expect(screen.getByText("₹9,000.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute("href", "/revenue/instalments/pp1");
  });
});
