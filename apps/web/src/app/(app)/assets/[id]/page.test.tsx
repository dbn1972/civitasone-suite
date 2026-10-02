import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAssetByIdMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getAssetById: (id: string) => getAssetByIdMock(id) }));
const rolesMock = vi.fn<() => string[]>(() => ["asset_manager"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("./AssetDetailActions", () => ({ AssetDetailActions: () => <div data-testid="actions" /> }));
vi.mock("./AssetFinancialActions", () => ({ AssetFinancialActions: () => null }));
vi.mock("../../../_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: () => <div data-testid="eoffice" /> }));

import AssetDetailPage from "./page";

const ASSET = {
  id: "a1", assetCode: "AST-1", name: "Laptop", status: "active", category: "IT",
  purchaseDate: "2025-04-01", purchaseCost: "5000000", currentValue: "4000000",
  depreciationSchedule: [], maintenanceHistory: [],
};

// GAP-ASSETS-DETAIL-01
describe("AssetDetailPage sub-fetch failures", () => {
  beforeEach(() => { getAssetByIdMock.mockReset(); rolesMock.mockReturnValue(["asset_manager"]); });

  it("shows a load error, not 'No depreciation schedule', when /depreciation failed", async () => {
    getAssetByIdMock.mockResolvedValue({ data: ASSET, source: "api", parts: { depreciation: "error", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.queryByText("No depreciation schedule")).not.toBeInTheDocument();
    expect(screen.getAllByText(/depreciation schedule/i).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
  });

  it("shows the maintenance card with an error instead of hiding it", async () => {
    getAssetByIdMock.mockResolvedValue({ data: ASSET, source: "api", parts: { depreciation: "api", maintenance: "error" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByText("Maintenance history")).toBeInTheDocument();
    expect(screen.getByText("No depreciation schedule")).toBeInTheDocument();
  });

  it("renders the empty schedule state when every part loaded", async () => {
    getAssetByIdMock.mockResolvedValue({ data: ASSET, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByText("No depreciation schedule")).toBeInTheDocument();
    expect(screen.queryByText("Maintenance history")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-DETAIL-02
  it("hides the eOffice disposal route for a read-only role", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    getAssetByIdMock.mockResolvedValue({ data: ASSET, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.queryByTestId("eoffice")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-INFRA-05
  it("hides the movable-only Tagged and AMC lifecycle steps for an infrastructure asset", async () => {
    getAssetByIdMock.mockResolvedValue({ data: { ...ASSET, type: "infra" }, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.queryByText("Tagged")).not.toBeInTheDocument();
    expect(screen.queryByText("AMC")).not.toBeInTheDocument();
    expect(screen.getByText("Acquired (GRN)")).toBeInTheDocument();
    expect(screen.getByText("In use")).toBeInTheDocument();
  });

  it("keeps Tagged and AMC for a movable asset", async () => {
    getAssetByIdMock.mockResolvedValue({ data: { ...ASSET, type: "movable" }, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByText("Tagged")).toBeInTheDocument();
    expect(screen.getByText("AMC")).toBeInTheDocument();
  });
});
