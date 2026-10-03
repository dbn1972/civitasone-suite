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
function apiResult(items: Array<Record<string, unknown>>, metaOverrides: Partial<{ total: number; hasMore: boolean; transfersTotal: number; promotionsTotal: number }> = {}) {
  return {
    data: {
      items,
      total: metaOverrides.total ?? items.length,
      hasMore: metaOverrides.hasMore ?? false,
      transfersTotal: metaOverrides.transfersTotal ?? 0,
      promotionsTotal: metaOverrides.promotionsTotal ?? 0,
    },
    source: "api" as const,
  };
}

function errorResult(overrides: { status?: number; errorMessage?: string } = {}) {
  return {
    data: { items: [], total: 0, hasMore: false, transfersTotal: 0, promotionsTotal: 0 },
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

  it("ignores ?empId= for a non-HR caller (own record only, never someone else's by URL)", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    fetchJsonMock.mockResolvedValue(apiResult([]));
    await renderPage({ searchParams: { empId: "someone-elses-id" } });
    expect(fetchJsonMock).toHaveBeenCalledWith("/api/v1/hrms/service-book/me", expect.anything(), expect.anything());
  });
});
