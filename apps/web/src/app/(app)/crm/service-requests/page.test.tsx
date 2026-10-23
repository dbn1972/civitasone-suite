import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getList = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getCrmServiceRequests: (...a: unknown[]) => getList(...a),
}));

const mockRoles = vi.fn<() => string[]>();
const mockUserId = vi.fn<() => string | null>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles(), getSessionUserId: () => mockUserId() };
});

// GAP-CRM-SERVICE-REQUESTS-03: the page resolves owner ids to names through the shared directory helper.
const resolveUsersMock = vi.fn<(ids: Iterable<string>) => Promise<Map<string, string>>>();
vi.mock("@/lib/directory/resolveUsers", () => ({
  resolveUsers: (ids: Iterable<string>) => resolveUsersMock(ids),
}));

vi.mock("./ServiceRequestsTable", () => ({
  ServiceRequestsTable: (props: Record<string, unknown>) => {
    return (
      <div
        data-testid="table"
        data-can-export={String(props.canExport)}
        data-page={String(props.page)}
        data-page-count={String(props.pageCount)}
        data-total={String(props.total)}
        data-query-key={String(props.queryKey)}
        data-assignee-names={JSON.stringify(props.assigneeNames)}
      />
    );
  },
}));
vi.mock("./ServiceRequestsFilterBar", () => ({
  ServiceRequestsFilterBar: (props: Record<string, unknown>) => (
    <div
      data-testid="filter-bar"
      data-assigned-to={String(props.assignedTo)}
      data-overdue={String(props.overdue)}
      data-sort={String(props.sort)}
      data-current-user={String(props.currentUserId)}
    />
  ),
}));

import Page from "./page";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function withIntl(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

function mockRows(n: number, total: number, statusCounts: Record<string, number> = {}) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `sr-${i}`, referenceNo: `R${i}`, citizenName: "X", serviceType: "Birth Certificate",
    subject: "s", priority: "normal", status: "open", assignedTo: null, dueAt: null, createdAt: null,
  }));
  getList.mockResolvedValue({ data: { rows, total, statusCounts }, source: "api" });
}

beforeEach(() => {
  getList.mockReset();
  mockRoles.mockReset();
  mockRoles.mockReturnValue(["crm_user"]);
  mockUserId.mockReset();
  mockUserId.mockReturnValue(null);
  resolveUsersMock.mockReset();
  resolveUsersMock.mockResolvedValue(new Map());
});

describe("ServiceRequestsPage — GAP-CRM-SERVICE-REQUESTS-01 (server pagination)", () => {
  it("requests the given page with a server limit and derives pageCount from the real total", async () => {
    mockRows(15, 132);
    render(withIntl(await Page({ searchParams: Promise.resolve({ page: "2" }) })));
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ limit: 15, page: 2 }));
    // 132 / 15 = 9 pages
    expect(screen.getByTestId("table").dataset.pageCount).toBe("9");
    expect(screen.getByTestId("table").dataset.page).toBe("2");
    expect(screen.getByTestId("table").dataset.total).toBe("132");
  });

  it("forwards status/search filters to the loader", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: Promise.resolve({ status: "pending", search: "water" }) })));
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", search: "water", page: 1, limit: 15 }));
  });

  it("defaults to page 1 for an invalid ?page", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: Promise.resolve({ page: "-3" }) })));
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });
});

describe("ServiceRequestsPage — GAP-CRM-SERVICE-REQUESTS-05 (summary tiles)", () => {
  it("shows server-side status counts that sum to the total, with no '(this page)' labels and a Cancelled tile", async () => {
    // 15 loaded but a register of 132: counts come from the server, not the page.
    mockRows(15, 132, { open: 40, in_progress: 20, pending: 30, resolved: 12, closed: 20, cancelled: 10 });
    render(await Page({ searchParams: Promise.resolve({}) }));

    // Open/In Progress = 40+20 = 60; Pending = 30; Closed/Resolved = 20+12 = 32; Cancelled = 10.
    // 60 + 30 + 32 + 10 = 132 = total.
    expect(screen.getByText("Open / In Progress")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.queryByText(/\(this page\)/)).not.toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
  });
});

describe("ServiceRequestsPage — GAP-CRM-SERVICE-REQUESTS-02 (export role gate)", () => {
  it("does NOT allow export for a plain crm_user", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: Promise.resolve({}) })));
    expect(screen.getByTestId("table").dataset.canExport).toBe("false");
  });

  it("allows export for crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: Promise.resolve({}) })));
    expect(screen.getByTestId("table").dataset.canExport).toBe("true");
  });
});

describe("ServiceRequestsPage — GAP-CRM-SERVICE-REQUESTS-03 (owner names, overdue / mine filters, due-date sort)", () => {
  const ME = "11111111-2222-4333-8444-555566667777";
  const ANITA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("forwards assignedTo, overdue=true and sort=dueAt to the loader and the offline cache key", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: Promise.resolve({ assignedTo: ME, overdue: "true", sort: "dueAt" }) })));
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: ME, overdue: true, sort: "dueAt" }));
    const key = screen.getByTestId("table").dataset.queryKey ?? "";
    expect(key).toContain(`assignedTo=${ME}`);
    expect(key).toContain("overdue=true");
    expect(key).toContain("sort=dueAt");
  });

  it("ignores a malformed owner id, an unknown sort and overdue values other than 'true' instead of sending them", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: Promise.resolve({ assignedTo: "not-a-uuid", overdue: "yes", sort: "citizenName" }) })));
    const arg = getList.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("assignedTo");
    expect(arg).not.toHaveProperty("overdue");
    expect(arg).not.toHaveProperty("sort");
  });

  it("resolves the owners of the loaded rows to names in ONE directory call and hands them to the table", async () => {
    const rows = [
      { id: "sr-1", referenceNo: "R1", citizenName: "X", serviceType: "t", subject: "s", priority: "normal", status: "open", assignedTo: ANITA, dueAt: null, createdAt: null },
      { id: "sr-2", referenceNo: "R2", citizenName: "Y", serviceType: "t", subject: "s", priority: "normal", status: "open", assignedTo: ANITA, dueAt: null, createdAt: null },
      { id: "sr-3", referenceNo: "R3", citizenName: "Z", serviceType: "t", subject: "s", priority: "normal", status: "open", assignedTo: null, dueAt: null, createdAt: null },
    ];
    getList.mockResolvedValue({ data: { rows, total: 3, statusCounts: {} }, source: "api" });
    resolveUsersMock.mockResolvedValue(new Map([[ANITA, "Anita Desai"]]));
    render(withIntl(await Page({ searchParams: Promise.resolve({}) })));
    expect(resolveUsersMock).toHaveBeenCalledTimes(1);
    expect([...(resolveUsersMock.mock.calls[0]![0] as Iterable<string>)]).toEqual([ANITA, ANITA]);
    expect(JSON.parse(screen.getByTestId("table").dataset.assigneeNames ?? "{}")).toEqual({ [ANITA]: "Anita Desai" });
  });

  it("passes the signed-in user id to the filter bar (for the 'Assigned to me' toggle)", async () => {
    mockUserId.mockReturnValue(ME);
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: Promise.resolve({ assignedTo: ME, overdue: "true" }) })));
    const bar = screen.getByTestId("filter-bar");
    expect(bar.dataset.currentUser).toBe(ME);
    expect(bar.dataset.assignedTo).toBe(ME);
    expect(bar.dataset.overdue).toBe("true");
  });
});
