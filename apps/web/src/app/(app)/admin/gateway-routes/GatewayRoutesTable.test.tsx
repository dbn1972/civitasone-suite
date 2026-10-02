import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => seeded(...a) }));

import { GatewayRoutesTable } from "./GatewayRoutesTable";
import type { GatewayRouteRow } from "./routeModel";

const ROWS: GatewayRouteRow[] = [
  { id: "a", name: "hrms-leave-requests", module: "hrms", method: "POST", path: "/v1/hrms/leave/requests", upstream: "http://hrms", status: "active", updated: "16 Jan 2024, 12:30 am" },
  { id: "b", name: "hrms-leave-approvals", module: "hrms", method: "GET", path: "/v1/hrms/leave/approvals", upstream: "", status: "draft", updated: "—" },
  { id: "c", name: "finance-bills", module: "finance", method: "GET", path: "/v1/finance/bills", upstream: "", status: "active", updated: "—" },
];

describe("GatewayRoutesTable", () => {
  beforeEach(() => { refreshMock.mockReset(); seeded.mockReset(); });

  // GAP-ADMIN-GATEWAY-ROUTES-02/03
  it("shows Method, Path, Upstream, Status, Updated and two slug-prefixed routes stay distinguishable", () => {
    seeded.mockReturnValue({ data: ROWS, provenance: "live", offline: false, cachedAt: null });
    render(<GatewayRoutesTable routes={ROWS} source="api" />);
    for (const h of ["Method", "Path", "Upstream", "Status", "Updated"]) {
      expect(screen.getByRole("columnheader", { name: new RegExp(h) })).toBeInTheDocument();
    }
    expect(screen.getByText("/v1/hrms/leave/requests")).toBeInTheDocument();
    expect(screen.getByText("/v1/hrms/leave/approvals")).toBeInTheDocument();
    expect(screen.queryByText("hrms-lea")).not.toBeInTheDocument();
    expect(screen.getByText("16 Jan 2024, 12:30 am")).toBeInTheDocument();
  });

  it("search 'leave' narrows the rows", () => {
    seeded.mockReturnValue({ data: ROWS, provenance: "live", offline: false, cachedAt: null });
    render(<GatewayRoutesTable routes={ROWS} source="api" />);
    fireEvent.change(screen.getByPlaceholderText("Search routes…"), { target: { value: "leave" } });
    expect(screen.queryByText("/v1/finance/bills")).not.toBeInTheDocument();
    expect(screen.getByText("/v1/hrms/leave/requests")).toBeInTheDocument();
  });

  it("error with no cache: Retry, no 'No routes registered'", () => {
    seeded.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null });
    render(<GatewayRoutesTable routes={[]} source="error" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No routes registered/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalled();
  });

  // GAP-ADMIN-GATEWAY-ROUTES-04
  it("empty catalogue shows route-specific copy and the card is titled Routes", () => {
    seeded.mockReturnValue({ data: [], provenance: "live", offline: false, cachedAt: null });
    render(<GatewayRoutesTable routes={[]} source="api" />);
    expect(screen.getByText("No routes registered")).toBeInTheDocument();
    expect(screen.getByText("Routes")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to show yet for this module.")).not.toBeInTheDocument();
  });
});
