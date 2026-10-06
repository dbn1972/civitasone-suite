import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
// RefreshErrorState uses next/navigation's useRouter for its retry action
// (router.refresh); stub it so the error branch renders in a plain RTL render.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

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

  // GAP-IDENTITY-{API-KEYS,BREAKGLASS,SESSIONS,USERS,WEBAUTHN}-05: a failed
  // fetch with no cache now renders a real error state WITH a working Retry,
  // not the amber "Couldn't load — showing nothing" badge stacked on the
  // "No records" EmptyState (which made a hard failure and a genuine empty
  // result look alike and offered no way to recover). This asserts the NEW
  // behaviour and fails on the old code.
  it("shows a retryable error state (no 'No records', no 'showing nothing') when the fetch failed and no cache exists", () => {
    mockedHook.mockReturnValue({
      data: [],
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "error-no-data",
    } as never);
    render(<ModuleListTable cacheKey="test" rows={[]} source="error" errorArea="sessions" />);

    // A real retry affordance exists now.
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    // The old ambiguous copy is gone.
    expect(screen.queryByText(/Couldn't load — showing nothing/i)).not.toBeInTheDocument();
    expect(screen.queryByText("No records")).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing saved data/i)).not.toBeInTheDocument();
  });
  // GAP-ADMIN-GATEWAY-ROUTES-02
  it("slug ids are shown in full (two ids sharing an 8-char prefix stay distinguishable); UUIDs are still shortened with the full id in the title", () => {
    const slugRows = [
      { id: "hrms-leave-requests", label: "A" },
      { id: "hrms-leave-approvals", label: "B" },
      { id: "3f2a9c1e-1111-4000-8000-000000000001", label: "C" },
    ];
    mockedHook.mockReturnValue({ data: slugRows, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={slugRows} source="api" />);
    expect(screen.getByText("hrms-leave-requests")).toBeInTheDocument();
    expect(screen.getByText("hrms-leave-approvals")).toBeInTheDocument();
    const short = screen.getByText("3f2a9c1e");
    expect(short).toHaveAttribute("title", "3f2a9c1e-1111-4000-8000-000000000001");
  });

  // GAP-FIELD-{AGENTS,ROUTES,SYNC,TASKS}-0x (UUID theme): status renders as a
  // coloured StatusPill (humanized), never raw lowercase text; a date-typed
  // meta is formatted with formatIndianDate, never a raw ISO timestamp.
  it("renders status as a StatusPill and formats a date-typed meta", () => {
    const fieldRows = [
      { id: "a1b2c3d4-0000-4000-8000-000000000001", label: "Task A", status: "pending", meta: "2026-09-27T09:14:00.000Z", metaKind: "date" as const },
    ];
    mockedHook.mockReturnValue({ data: fieldRows, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={fieldRows} source="api" />);
    // StatusPill humanizes "pending" -> "Pending" inside a .pill span.
    const pill = screen.getByText("Pending");
    expect(pill).toHaveClass("pill");
    // Date meta is formatted "27 Sep 2026", never the raw ISO string.
    expect(screen.getByText("27 Sep 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-09-27T09:14:00.000Z")).not.toBeInTheDocument();
  });

  it("leaves a text-typed meta verbatim (no date coercion)", () => {
    const fieldRows = [
      { id: "x", label: "Agent 1", meta: "3", metaKind: "text" as const },
    ];
    mockedHook.mockReturnValue({ data: fieldRows, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={fieldRows} source="api" />);
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
