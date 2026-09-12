import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("../../../../_components/Chart", () => ({
  Chart: () => null,
}));

import GpfStatementsPage from "./page";

const MOCK_ROWS = [
  { id: "g1", employeeId: "emp-00000001", period: "2026-08", empContribMinor: 500000 },
];

function mockGpf(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/payroll/statutory/gpf")) {
      return Promise.resolve(result);
    }
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("GpfStatementsPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the GPF ledger and real stat counts on success", async () => {
    mockGpf({ data: MOCK_ROWS, source: "api" });
    render(await GpfStatementsPage());
    expect(screen.getByText("Statements").parentElement).toHaveTextContent("1");
  });

  it("shows the honest empty state when a tenant genuinely has zero GPF statements (source: api, [])", async () => {
    mockGpf({ data: [], source: "api" });
    render(await GpfStatementsPage());
    expect(screen.getByText("No GPF statements")).toBeInTheDocument();
    // A real zero corpus — ₹0 — is an honest reading of zero contributions,
    // not a dash. It legitimately appears twice (the stat card and the
    // "Accumulated Corpus" dashboard box), and a third "₹0" projected-value
    // box only when there is at least one period of history, so assert
    // presence rather than count.
    expect(screen.getAllByText("₹0").length).toBeGreaterThan(0);
  });

  it("shows the error state and hides the fabricated ₹0 corpus on a real fetch failure (source: error)", async () => {
    mockGpf({ data: [], source: "error" });
    render(await GpfStatementsPage());
    expect(screen.getByText("We couldn't load this GPF statements.")).toBeInTheDocument();
    expect(screen.queryByText("No GPF statements")).not.toBeInTheDocument();
    // Accumulated Corpus / stat cards show "—", never a fabricated ₹0 derived
    // from the empty error payload.
    expect(screen.queryByText("₹0")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
