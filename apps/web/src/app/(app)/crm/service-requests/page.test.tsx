import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getList = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getCrmServiceRequests: (...a: unknown[]) => getList(...a),
}));

const mockRoles = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => mockRoles() };
});

vi.mock("./ServiceRequestsTable", () => ({
  ServiceRequestsTable: (props: Record<string, unknown>) => {
    return <div data-testid="table" data-can-export={String(props.canExport)} data-page={String(props.page)} data-page-count={String(props.pageCount)} data-total={String(props.total)} />;
  },
}));
vi.mock("./ServiceRequestsFilterBar", () => ({
  ServiceRequestsFilterBar: () => <div data-testid="filter-bar" />,
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

function mockRows(n: number, total: number) {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `sr-${i}`, referenceNo: `R${i}`, citizenName: "X", serviceType: "Birth Certificate",
    subject: "s", priority: "normal", status: "open", assignedTo: null, dueAt: null, createdAt: null,
  }));
  getList.mockResolvedValue({ data: { rows, total }, source: "api" });
}

beforeEach(() => {
  getList.mockReset();
  mockRoles.mockReset();
  mockRoles.mockReturnValue(["crm_user"]);
});

describe("ServiceRequestsPage — GAP-CRM-SERVICE-REQUESTS-01 (server pagination)", () => {
  it("requests the given page with a server limit and derives pageCount from the real total", async () => {
    mockRows(15, 132);
    render(withIntl(await Page({ searchParams: { page: "2" } })));
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ limit: 15, page: 2 }));
    // 132 / 15 = 9 pages
    expect(screen.getByTestId("table").dataset.pageCount).toBe("9");
    expect(screen.getByTestId("table").dataset.page).toBe("2");
    expect(screen.getByTestId("table").dataset.total).toBe("132");
  });

  it("forwards status/search filters to the loader", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: { status: "pending", search: "water" } })));
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ status: "pending", search: "water", page: 1, limit: 15 }));
  });

  it("defaults to page 1 for an invalid ?page", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: { page: "-3" } })));
    expect(getList).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });
});

describe("ServiceRequestsPage — GAP-CRM-SERVICE-REQUESTS-02 (export role gate)", () => {
  it("does NOT allow export for a plain crm_user", async () => {
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: {} })));
    expect(screen.getByTestId("table").dataset.canExport).toBe("false");
  });

  it("allows export for crm_admin", async () => {
    mockRoles.mockReturnValue(["crm_admin"]);
    mockRows(1, 1);
    render(withIntl(await Page({ searchParams: {} })));
    expect(screen.getByTestId("table").dataset.canExport).toBe("true");
  });
});
