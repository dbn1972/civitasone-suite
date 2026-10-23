import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getPOsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getProcurementPOs: (...a: unknown[]) => getPOsMock(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["procurement_officer"],
  hasAnyRole: () => true,
  PROCUREMENT_WRITE_ROLES: ["procurement_officer"],
}));
// Keep the client table out of this server-page test: record what it was given.
vi.mock("./OrdersTable", () => ({
  OrdersTable: (props: { initialStatus?: string }) => <div data-testid="orders-table" data-initial-status={props.initialStatus ?? ""} />,
}));

import OrdersPage from "./page";

describe("OrdersPage ?status= (GAP-PROCUREMENT-DASHBOARD-02)", () => {
  beforeEach(() => {
    getPOsMock.mockReset();
    getPOsMock.mockResolvedValue({ data: [], source: "api" });
  });

  async function initialStatusFor(searchParams?: Record<string, string | string[] | undefined>): Promise<string | null> {
    const { unmount } = render(await OrdersPage(searchParams === undefined ? {} : { searchParams: Promise.resolve(searchParams) }));
    const value = screen.getByTestId("orders-table").getAttribute("data-initial-status");
    unmount();
    return value;
  }

  it("opens narrowed to the status the dashboard's 'Active POs' link carries", async () => {
    expect(await initialStatusFor({ status: "approved" })).toBe("approved");
  });

  it("understands the first dashboard link's 'active' and takes the first value of a repeated param", async () => {
    expect(await initialStatusFor({ status: "active" })).toBe("approved");
    expect(await initialStatusFor({ status: ["approved", "draft"] })).toBe("approved");
  });

  it("shows everything when there is no status or it is not a known PO status", async () => {
    expect(await initialStatusFor()).toBe("");
    expect(await initialStatusFor({ status: "bogus" })).toBe("");
  });
});
