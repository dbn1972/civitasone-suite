import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { ModuleListTable } from "./ModuleListTable";

const mockedHook = vi.mocked(useSeededResource);

const rows = [
  { id: "abc12345-1234", label: "Bill #001", sublabel: "Vendor A", status: "approved", meta: "₹1L" },
  { id: "def67890-5678", label: "Bill #002", sublabel: "Vendor B", status: "pending", meta: "₹2L" },
];

describe("ModuleListTable", () => {
  beforeEach(() => {
    mockedHook.mockReturnValue({
      data: rows,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
  });

  it("renders table with headers", () => {
    render(<ModuleListTable cacheKey="test" rows={rows} source="api" />);
    expect(screen.getByText("ID")).toBeInTheDocument();
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Status")).toBeInTheDocument();
  });

  it("renders row data", () => {
    render(<ModuleListTable cacheKey="test" rows={rows} source="api" />);
    expect(screen.getByText("Bill #001")).toBeInTheDocument();
    expect(screen.getByText("Bill #002")).toBeInTheDocument();
    expect(screen.getByText("Vendor A")).toBeInTheDocument();
  });

  it("renders empty state when no rows", () => {
    mockedHook.mockReturnValue({ data: [], fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={[]} source="api" />);
    expect(screen.getByText("No records")).toBeInTheDocument();
  });

  it("shows nothing extra when data is live", () => {
    render(<ModuleListTable cacheKey="test" rows={rows} source="api" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  // UX-012 (UX-002's pattern): this is the exact contradiction the gap named —
  // ModuleListPage used to render `<DataSourceBadge source={source} />`
  // straight off the raw server `source`, while this table separately
  // derived `fromCache` from its own useSeededResource call. A failed fetch
  // with a usable cache showed BOTH "Couldn't load — showing nothing" (page)
  // AND "Showing saved data" (table) at once. Now both read the same
  // `provenance` value from one hook call, so only one message can render.
  it("shows ONE consistent message when the fetch failed but a cached copy exists", () => {
    mockedHook.mockReturnValue({
      data: rows,
      fromCache: true,
      offline: false,
      cachedAt: "2026-09-01T09:30:00.000Z",
      provenance: "cached",
    } as never);
    render(<ModuleListTable cacheKey="test" rows={[]} source="error" />);

    const statusNodes = screen.getAllByRole("status");
    expect(statusNodes).toHaveLength(1);
    expect(statusNodes[0]).toHaveTextContent(/Showing saved data/i);
    expect(statusNodes[0]).toHaveTextContent(/could not refresh/i);
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
    render(<ModuleListTable cacheKey="test" rows={[]} source="error" />);

    // Two independent role="status" live regions now legitimately coexist here:
    // the page-level DataSourceBadge (data-provenance banner) and EmptyState's
    // own live region (a11y HIGH-3 — a screen reader must hear "no results"
    // too, not just see it). Assert each by its specific text rather than
    // assuming there is exactly one status node.
    expect(screen.getByText(/Couldn't load — showing nothing/i)).toBeInTheDocument();
    expect(screen.queryByText(/Showing saved data/i)).not.toBeInTheDocument();
    expect(screen.getByText("No records")).toBeInTheDocument();
  });
});
