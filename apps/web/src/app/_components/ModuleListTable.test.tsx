import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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

  // GAP-INSTALL-{MODULES,SILOS,STAGES}-03 (CAP): the status cell renders a
  // StatusPill (humanized label + non-colour cue via the `pill` class), not a
  // bare raw lowercase enum string.
  it("renders the status column as a StatusPill with a humanized label", () => {
    mockedHook.mockReturnValue({
      data: [{ id: "s1", label: "Row", status: "in_progress" }],
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
    render(<ModuleListTable cacheKey="test" rows={[]} source="api" />);
    const pill = screen.getByText("In Progress");
    expect(pill).toHaveClass("pill");
  });

  // GAP-INSTALL-STEPS-03 (CAP): the raw <table className="tbl"> had no
  // pagination — all N rows rendered at once. The DataTable paginates at
  // pageSize=15, so 30 rows render only 15 and expose a pager. Fails on the
  // old code (which rendered all 30 and had no pager).
  it("paginates at 15 rows per page and shows a pager for 30 rows", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      id: `row-${String(i + 1).padStart(2, "0")}`,
      label: `Record ${i + 1}`,
    }));
    mockedHook.mockReturnValue({
      data: many,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
    render(<ModuleListTable cacheKey="test" rows={[]} source="api" />);

    // First page only: Record 1 is visible, Record 16 (page 2) is not.
    expect(screen.getByText("Record 1")).toBeInTheDocument();
    expect(screen.queryByText("Record 16")).not.toBeInTheDocument();
    // A pager control exists and advances to the next page.
    const next = screen.getByText("Next →");
    expect(next).toBeInTheDocument();
    fireEvent.click(next);
    expect(screen.getByText("Record 16")).toBeInTheDocument();
    expect(screen.queryByText("Record 1")).not.toBeInTheDocument();
  });

  // GAP-INSTALL-STEPS-03 (CAP): the old table had no filter box. The DataTable
  // exposes a filterable searchbox that narrows the visible rows. Fails on the
  // old code (no textbox at all).
  it("exposes a filter box that narrows the visible rows", () => {
    const data = [
      { id: "a1", label: "Alpha module" },
      { id: "b2", label: "Beta module" },
    ];
    mockedHook.mockReturnValue({
      data,
      fromCache: false,
      offline: false,
      cachedAt: null,
      provenance: "live",
    } as never);
    render(<ModuleListTable cacheKey="test" rows={[]} source="api" />);

    const box = screen.getByRole("searchbox");
    fireEvent.change(box, { target: { value: "Alpha" } });
    expect(screen.getByText("Alpha module")).toBeInTheDocument();
    expect(screen.queryByText("Beta module")).not.toBeInTheDocument();
  });

  // GAP-CATALOGUE-CATEGORIES-01 (TREE): a flattened hierarchy row carries an
  // optional 0-based `depth`; the Name cell is indented by depth*16px and a
  // nested row names its parent. Rows without `depth` render flush (asserted
  // by every other test above, which pass no depth).
  it("indents a nested tree row by its depth and shows its parent", () => {
    const treeRows = [
      { id: "root", label: "Banking", depth: 0 },
      { id: "child", label: "Savings", depth: 1, parentLabel: "Banking" },
    ];
    mockedHook.mockReturnValue({ data: treeRows, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={treeRows} source="api" />);

    const childCell = screen.getByText("Savings");
    expect(childCell).toHaveStyle({ paddingLeft: "16px" });
    expect(childCell).toHaveTextContent(/in Banking/i);

    const rootCell = screen.getByText("Banking");
    // depth 0 (falsy) => no indent style applied.
    expect(rootCell.getAttribute("style") ?? "").not.toContain("padding-left");
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

  // GAP-TENANT-{CODE-LISTS-05, CONSENT-EXCHANGE-05, DATA-MIGRATION-05,
  // ORG-HIERARCHY-05, OVERVIEW-06, PLANS-05}: Status renders through StatusPill.
  it("renders status through StatusPill, not raw snake_case text", () => {
    const pillRows = [
      { id: "r-1", label: "Row A", status: "active" },
      { id: "r-2", label: "Row B", status: "pending_approval" },
    ];
    mockedHook.mockReturnValue({ data: pillRows, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={pillRows} source="api" />);
    // StatusPill renders a <span class="pill ..."> with humanized text
    const pills = document.querySelectorAll(".pill");
    expect(pills.length).toBeGreaterThanOrEqual(2);
    // Humanized by StatusPill: "active" -> "Active", "pending_approval" -> "Pending Approval"
    expect(pills[0].textContent).toBe("Active");
    expect(pills[1].textContent).toBe("Pending Approval");
  });

  // GAP-TENANT-*-05: client search/filter narrows rows.
  it("client search box filters rows by label match", () => {
    mockedHook.mockReturnValue({ data: rows, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={rows} source="api" />);
    const input = screen.getByRole("searchbox", { name: /search records/i });
    fireEvent.change(input, { target: { value: "#001" } });
    expect(screen.getByText("Bill #001")).toBeInTheDocument();
    expect(screen.queryByText("Bill #002")).not.toBeInTheDocument();
  });

  // GAP-TENANT-*-05: sortable Name header.
  it("clicking the Name header sorts rows alphabetically", () => {
    const sortRows = [
      { id: "r-z", label: "Zebra", status: "active" },
      { id: "r-a", label: "Alpha", status: "pending" },
    ];
    mockedHook.mockReturnValue({ data: sortRows, fromCache: false, offline: false, cachedAt: null, provenance: "live" } as never);
    render(<ModuleListTable cacheKey="test" rows={sortRows} source="api" />);
    const nameHeader = screen.getByText("Name", { selector: "th" });
    fireEvent.click(nameHeader);
    const names = Array.from(document.querySelectorAll("tbody td:nth-child(2)")).map((el) => el.textContent);
    expect(names).toEqual(["Alpha", "Zebra"]);
  });
});
