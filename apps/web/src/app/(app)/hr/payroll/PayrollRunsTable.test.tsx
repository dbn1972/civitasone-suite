import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { PayrollRunsTable } from "./PayrollRunsTable";

const mockedHook = vi.mocked(useSeededResource);

const sampleRuns = [
  {
    id: "run-1",
    payPeriod: "2026-08",
    employeeCount: 120,
    grossAmount: 4500000,
    netAmount: 4100000,
    status: "paid",
  },
] as never;

describe("PayrollRunsTable — UX-002 (single source of truth for data provenance)", () => {
  beforeEach(() => {
    mockedHook.mockReturnValue({
      data: sampleRuns,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  });

  it("shows nothing extra when data is live", () => {
    render(<PayrollRunsTable runs={sampleRuns} source="api" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // This is the exact contradiction named in the gap report: hr/payroll/page.tsx
  // used to render `<DataSourceBadge source={source} message="Couldn't load
  // payroll runs — showing nothing" />` directly from the server's `source`,
  // while this table separately derived `fromCache` from useSeededResource —
  // so a failed fetch with a usable cache showed BOTH "showing nothing" (from
  // the page) AND "Showing saved data" (from this table) at once. Now both
  // read the same `provenance` value from one hook call, so only one message
  // can ever render for a given fetch outcome.
  it("shows ONE consistent message when the fetch failed but cached payroll runs exist", () => {
    mockedHook.mockReturnValue({
      data: sampleRuns,
      fromCache: true,
      offline: false,
      cachedAt: "2026-09-01T09:30:00.000Z",
      provenance: "cached",
    } as never);
    render(<PayrollRunsTable runs={[]} source="error" />);

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Showing saved data/i);
    expect(statusNodes[0]).toHaveTextContent(/could not refresh/i);
    // The contradictory "showing nothing" copy must never appear alongside it.
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
  });

  it("shows an honest, unambiguous empty state when the fetch failed and no cache exists", () => {
    mockedHook.mockReturnValue({
      data: [],
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "error-no-data",
    } as never);
    render(<PayrollRunsTable runs={[]} source="error" />);

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Couldn't load payroll runs — showing nothing/i);
    expect(screen.queryByText(/Showing saved data/i)).not.toBeInTheDocument();
    expect(screen.getByText("No payroll runs yet")).toBeInTheDocument();
  });
});
