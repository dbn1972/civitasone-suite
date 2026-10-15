import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatMoney } from "@/lib/formatters";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import AuditObservationsPage from "./page";

const row = (id: string, status: string, amount?: number | string) => ({
  id, observationNo: `OBS-${id}`, title: `Finding ${id}`, type: "internal", severity: "major",
  department: "Finance", raisedDate: "2026-09-01", status, ...(amount !== undefined ? { amount } : {}),
});

function tile(label: string): string {
  const lab = screen.getAllByText(label).find((el) => el.classList.contains("lab"));
  return lab?.parentElement?.querySelector(".val")?.textContent ?? "";
}

describe("AuditObservationsPage (GAP-AUDIT-OBSERVATIONS-02 / 03 / 06)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("OBS-02: tile values equal the filtered row counts across open/replied/partially_closed/closed", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [row("1", "open"), row("2", "replied"), row("3", "partially_closed"), row("4", "closed"), row("5", "compliance_pending")],
      source: "api",
    });
    render(await AuditObservationsPage());
    // Same predicates as the table segments: Open = not closed, Settled = closed,
    // Under Reply = replied | compliance_pending | partially_closed.
    expect(tile("Open")).toBe("4");
    expect(tile("Under Reply")).toBe("3");
    expect(tile("Settled")).toBe("1");
  });

  it("OBS-03: string amounts are summed numerically (not concatenated) into Total exposure", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [row("1", "open", "100"), row("2", "open", "250"), row("3", "closed", 50)],
      source: "api",
    });
    render(await AuditObservationsPage());
    expect(tile("Total exposure")).toBe(formatMoney(400n));
  });

  it("OBS-06: an empty tenant gets the guided 'Log your first observation' prompt", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await AuditObservationsPage());
    expect(screen.getByText("No observations yet")).toBeInTheDocument();
    expect(screen.getByText(/Log your first audit observation/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "+ Log Observation" }).length).toBeGreaterThan(1);
  });

  it("OBS-06: a fetch failure shows the error state and '—' tiles, never zeros or the empty prompt", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await AuditObservationsPage());
    expect(screen.getByText("We couldn't load audit observations.")).toBeInTheDocument();
    expect(tile("Open")).toBe("—");
    expect(tile("Total exposure")).toBe("—");
    expect(screen.queryByText("No observations yet")).not.toBeInTheDocument();
  });

  it("DASHBOARD-03: the 'Audit' breadcrumb goes to the module home (/audit), the same target as the sidebar", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await AuditObservationsPage());
    expect(screen.getByRole("link", { name: "Audit" })).toHaveAttribute("href", "/audit");
  });
});
