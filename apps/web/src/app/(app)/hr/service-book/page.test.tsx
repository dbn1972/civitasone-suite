import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["hr_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ServiceBookPage from "./page";

// UX-017 (tranche 3): ServiceBookPage now reads its copy through next-intl
// (getTranslations("serviceBook") server-side; ServiceBookView's own
// useTranslations("serviceBookView") client-side once rendered as a child)
// -- see departments/page.test.tsx's renderPage() comment for why both
// need a real provider in the tree.
async function renderPage(props: Parameters<typeof ServiceBookPage>[0] = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await ServiceBookPage(props)}
    </NextIntlClientProvider>,
  );
}

// The mock replaces fetchJson entirely (bypassing the page's own
// mapResponse), so it must resolve with the ALREADY-MAPPED shape the page
// destructures: { data: { items, total, hasMore, transfersTotal,
// promotionsTotal }, source, ... }.
function apiResult(items: Array<Record<string, unknown>>, metaOverrides: Partial<{ total: number; hasMore: boolean; employeesTotal: number; transfersTotal: number; promotionsTotal: number }> = {}) {
  return {
    data: {
      items,
      total: metaOverrides.total ?? items.length,
      hasMore: metaOverrides.hasMore ?? false,
      employeesTotal: metaOverrides.employeesTotal ?? new Set(items.map((i) => i.employeeId ?? i.employee)).size,
      transfersTotal: metaOverrides.transfersTotal ?? 0,
      promotionsTotal: metaOverrides.promotionsTotal ?? 0,
    },
    source: "api" as const,
  };
}

function errorResult(overrides: { status?: number; errorMessage?: string } = {}) {
  return {
    data: { items: [], total: 0, hasMore: false, employeesTotal: 0, transfersTotal: 0, promotionsTotal: 0 },
    source: "error" as const,
    ...overrides,
  };
}

describe("ServiceBookPage (HR caller)", () => {
  it("requests the tenant-wide list when no employee is specified", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(apiResult([]));
    await renderPage({});
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book", expect.anything(), expect.anything());
    expect(screen.getByRole("heading", { name: "Service Book" })).toBeInTheDocument();
  });

  it("scopes the request to one employee via ?empId= (previously ignored entirely)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      apiResult([{ id: "e1", employee: "Priya Nair", eventType: "transfer", effectiveDate: "2026-01-01" }], { transfersTotal: 1 }),
    );
    await renderPage({ searchParams: { empId: "emp-42" } });
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/service-book?employeeId=emp-42",
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByRole("heading", { name: /service book — priya nair/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view all employees/i })).toHaveAttribute("href", "/hr/service-book");
    // GAP-HR-SERVICE-BOOK-01: print link only makes sense once scoped to one employee.
    expect(screen.getByRole("link", { name: "Print service book" })).toHaveAttribute(
      "href",
      "/api/proxy/v1/hrms/employees/emp-42/service-book/pdf",
    );
  });

  // GAP-HR-SERVICE-BOOK-04: stats now come from the backend's full-scope
  // count (meta), not just whatever page happened to load.
  it("shows a truncation notice and full-scope stat totals when the backend reports hasMore", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      apiResult(
        [{ id: "e1", employee: "Priya Nair", eventType: "transfer", effectiveDate: "2026-01-01" }],
        { total: 1500, hasMore: true, transfersTotal: 900, promotionsTotal: 200 },
      ),
    );
    await renderPage({});
    expect(screen.getByText("Showing 1 of 1500 entries.")).toBeInTheDocument();
    expect(screen.getByText("Transfers / Postings").closest(".stat")).toHaveTextContent("900");
    expect(screen.getByText("Promotions / Increments").closest(".stat")).toHaveTextContent("200");
  });

  // GAP-HR-SERVICE-BOOK-04: the Employees stat is the server's distinct-employee count over the whole
  // scope, not the number of distinct names among the rows that happened to load.
  it("shows the full-scope Employees stat from the server, not a count of the loaded rows", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      apiResult(
        [{ id: "e1", employeeId: "emp-1", employee: "Priya Nair", eventType: "transfer", effectiveDate: "2026-01-01" }],
        { total: 1500, hasMore: true, employeesTotal: 240 },
      ),
    );
    await renderPage({});
    expect(screen.getByText("Employees").closest(".stat")).toHaveTextContent("240");
  });

  it("falls back to counting distinct employees in the response only when the API sends no employeesTotal", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockImplementation(async (_path: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
      data: opts.mapResponse({
        data: [
          { id: "e1", employeeId: "emp-1", employee: "Priya Nair", eventType: "join", effectiveDate: "2020-01-01" },
          { id: "e2", employeeId: "emp-2", employee: "Arjun Rao", eventType: "join", effectiveDate: "2020-01-02" },
        ],
        meta: { total: 2, hasMore: false },
      }),
      source: "api" as const,
    }));
    await renderPage({});
    expect(screen.getByText("Employees").closest(".stat")).toHaveTextContent("2");
    fetchJsonMock.mockReset();
  });

  // GAP-HR-SERVICE-BOOK-04: employee scope is a search-select, not a free-text box.
  it("offers an employee search-select (replacing the free-text filter) to HR", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(apiResult([]));
    await renderPage({});
    expect(screen.getByRole("combobox", { name: "Show one employee's service book" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by employee name")).not.toBeInTheDocument();
  });

  it("pre-fills the search-select with the scoped employee's name when ?empId= is set", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      apiResult([{ id: "e1", employeeId: "emp-42", employee: "Priya Nair", eventType: "join", effectiveDate: "2020-01-01" }]),
    );
    await renderPage({ searchParams: { empId: "emp-42" } });
    expect(screen.getByRole("combobox", { name: "Show one employee's service book" })).toHaveValue("Priya Nair");
  });

  // GAP-HR-SERVICE-BOOK-04: server pagination, newest first.
  it("page 1 with more entries: 'Older entries' links to page 2 and there is no 'Newer entries' link", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      apiResult([{ id: "e1", employee: "Priya Nair", eventType: "join", effectiveDate: "2026-01-01" }], { total: 1200, hasMore: true }),
    );
    await renderPage({});
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book", expect.anything(), expect.anything());
    expect(screen.getByRole("link", { name: "Older entries →" })).toHaveAttribute("href", "/hr/service-book?page=2");
    expect(screen.queryByRole("link", { name: "← Newer entries" })).not.toBeInTheDocument();
  });

  it("page 2 requests the next window of entries and links back to page 1; no 'Older' link on the last page", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      apiResult([{ id: "e9", employee: "Priya Nair", eventType: "join", effectiveDate: "2019-01-01" }], { total: 1200, hasMore: false }),
    );
    await renderPage({ searchParams: { page: "2" } });
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/service-book?limit=1000&offset=1000",
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByText("Showing 1 of 1200 entries.")).toBeInTheDocument();
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "← Newer entries" })).toHaveAttribute("href", "/hr/service-book");
    expect(screen.queryByRole("link", { name: "Older entries →" })).not.toBeInTheDocument();
  });

  it("keeps the employee scope in the pager links and the request", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      apiResult([{ id: "e1", employeeId: "emp-42", employee: "Priya Nair", eventType: "join", effectiveDate: "2026-01-01" }], { total: 2500, hasMore: true }),
    );
    await renderPage({ searchParams: { empId: "emp-42", page: "2" } });
    expect(fetchJsonMock).toHaveBeenCalledWith(
      "/api/v1/hrms/service-book?employeeId=emp-42&limit=1000&offset=1000",
      expect.anything(),
      expect.anything(),
    );
    expect(screen.getByRole("link", { name: "← Newer entries" })).toHaveAttribute("href", "/hr/service-book?empId=emp-42");
    expect(screen.getByRole("link", { name: "Older entries →" })).toHaveAttribute("href", "/hr/service-book?empId=emp-42&page=3");
  });

  it("treats a junk ?page= as page 1", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(apiResult([]));
    await renderPage({ searchParams: { page: "-4" } });
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book", expect.anything(), expect.anything());
  });

  it("shows an honest 'Access restricted' message (not the generic retry message) when the backend returns 403", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(
      errorResult({ status: 403, errorMessage: "requires one of: hr_admin, hr_officer, super_admin, manager" }),
    );

    await renderPage({});

    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(
      screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still shows the generic 'try again' message for a genuine transient failure (no status -- e.g. a network error)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue(errorResult());

    await renderPage({});

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });
});

// GAP-HR-SERVICE-BOOK-06: employees/managers previously hit the HR-only
// tenant-wide endpoint and got a permission error trying to see their OWN
// service book.
describe("ServiceBookPage (self-service caller)", () => {
  it("calls the /me endpoint instead of the tenant-wide list, and hides the employee-implying stat/filter", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockResolvedValue(
      apiResult([{ id: "e1", employee: "Priya Nair", eventType: "join", effectiveDate: "2020-01-01" }]),
    );
    await renderPage({});
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book/me", expect.anything(), expect.anything());
    expect(screen.getByRole("heading", { name: "My Service Book" })).toBeInTheDocument();
    expect(screen.queryByText("Employees")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Filter by employee name")).not.toBeInTheDocument();
  });

  // GAP-HR-SERVICE-BOOK-06: drive the page's own mapResponse with the REAL payload shape of
  // GET /v1/hrms/service-book/me (the list row shape: eventType / detail / status), so a shape
  // mismatch between backend and page can no longer hide behind a pre-mapped mock.
  it("renders the real /me payload: event badges and the attested status are visible to the employee", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockImplementation(async (_path: string, _fallback: unknown, opts: { mapResponse: (p: unknown) => unknown }) => ({
      data: opts.mapResponse({
        data: [
          { id: "m1", employeeId: "emp-1", employee: "Priya Nair", eventType: "join", detail: "Joined as Section Officer", effectiveDate: "2020-01-01", orderNo: "—", status: "recorded" },
          { id: "m2", employeeId: "emp-1", employee: "Priya Nair", eventType: "promotion", detail: "Promoted", effectiveDate: "2023-04-01", orderNo: "PROM/2023/07", status: "attested" },
          { id: "m3", employeeId: "emp-1", employee: "Priya Nair", eventType: "transfer", detail: "Moved to Finance", effectiveDate: "2024-02-01", orderNo: "TR/24/1", status: "attested" },
        ],
      }),
      source: "api" as const,
    }));
    await renderPage({});
    expect(screen.getByText("Promoted").closest("tr")).toHaveTextContent("Attested");
    expect(screen.getByText("Joined as Section Officer").closest("tr")).toHaveTextContent("Recorded");
    // Own-record stats, derived from the same rows.
    expect(screen.getByText("Total Entries").closest(".stat")).toHaveTextContent("3");
    expect(screen.getByText("Transfers / Postings").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Promotions / Increments").closest(".stat")).toHaveTextContent("1");
    // No tenant-wide controls for a self-service caller.
    expect(screen.queryByRole("combobox", { name: "Show one employee's service book" })).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Service book pages" })).not.toBeInTheDocument();
    fetchJsonMock.mockReset();
  });

  it("ignores ?empId= for a non-HR caller (own record only, never someone else's by URL)", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockResolvedValue(apiResult([]));
    await renderPage({ searchParams: { empId: "someone-elses-id" } });
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book/me", expect.anything(), expect.anything());
  });
});
