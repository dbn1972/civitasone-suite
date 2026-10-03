import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getDemandGrantById = vi.hoisted(() => vi.fn());
const getMajorHeadOptions = vi.hoisted(() => vi.fn());
const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("../demandDetail", async (orig) => ({ ...(await orig<typeof import("../demandDetail")>()), getDemandGrantById: (...a: unknown[]) => getDemandGrantById(...a), getMajorHeadOptions: (...a: unknown[]) => getMajorHeadOptions(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));
vi.mock("../DemandLinesEditor", () => ({ DemandLinesEditor: () => <div>lines-editor</div> }));
import DemandGrantDetailPage from "./page";

const demand = (over: Record<string, unknown> = {}) => ({ id: "d1", demandNo: "D-01", service: "Education", amountMinor: "100000", currency: "INR", class: "voted", status: "draft",
  lines: [{ id: "l1", headCode: "2202", headName: "General Education", amountMinor: "100000" }], linesTotalMinor: "100000", linesReconciled: true, ...over });

describe("DemandGrantDetailPage (GAP-FINANCE-BUDGET-DEMAND-GRANTS-04)", () => {
  beforeEach(() => { roles.current = ["finance_officer"]; getMajorHeadOptions.mockResolvedValue({ data: [], source: "api" }); });

  it("lists the head-wise lines of the demand", async () => {
    getDemandGrantById.mockResolvedValue({ data: demand(), source: "api" });
    render(await DemandGrantDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("Demand D-01")).toBeInTheDocument();
    expect(screen.getByText("General Education")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
  it("warns when the lines do not total the demand, and shows the empty state when there are none", async () => {
    getDemandGrantById.mockResolvedValue({ data: demand({ linesTotalMinor: "40000", linesReconciled: false }), source: "api" });
    const { unmount } = render(await DemandGrantDetailPage({ params: { id: "d1" } }));
    expect(screen.getByRole("alert")).toHaveTextContent(/differs from the demand amount/);
    unmount();
    getDemandGrantById.mockResolvedValue({ data: demand({ lines: [], linesTotalMinor: "0", linesReconciled: false }), source: "api" });
    render(await DemandGrantDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("No head-wise lines yet")).toBeInTheDocument();
  });
  it("offers the editor only for a draft demand and a write role", async () => {
    getDemandGrantById.mockResolvedValue({ data: demand(), source: "api" });
    const { unmount } = render(await DemandGrantDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("lines-editor")).toBeInTheDocument();
    unmount();
    roles.current = ["audit_officer"];
    const second = render(await DemandGrantDetailPage({ params: { id: "d1" } }));
    expect(screen.queryByText("lines-editor")).not.toBeInTheDocument();
    second.unmount();
    roles.current = ["finance_officer"];
    getDemandGrantById.mockResolvedValue({ data: demand({ status: "approved" }), source: "api" });
    render(await DemandGrantDetailPage({ params: { id: "d1" } }));
    expect(screen.queryByText("lines-editor")).not.toBeInTheDocument();
  });
  it("a real 404 is 'not found'; any other failure is a retryable error", async () => {
    getDemandGrantById.mockResolvedValue({ data: null, source: "error", status: 404 });
    const { unmount } = render(await DemandGrantDetailPage({ params: { id: "x" } }));
    expect(screen.getByText("Demand not found")).toBeInTheDocument();
    unmount();
    getDemandGrantById.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await DemandGrantDetailPage({ params: { id: "x" } }));
    expect(screen.queryByText("Demand not found")).not.toBeInTheDocument();
  });
});
