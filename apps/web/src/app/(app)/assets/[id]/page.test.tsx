import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAssetByIdMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getAssetById: (id: string) => getAssetByIdMock(id) }));
const rolesMock = vi.fn<() => string[]>(() => ["asset_manager"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("../AccountingBanner", () => ({ AccountingBanner: ({ areas }: { areas: string[] }) => <div data-testid="accounting-banner" data-areas={areas.join(",")} /> }));
vi.mock("./AssetDetailActions", () => ({ AssetDetailActions: () => <div data-testid="actions" /> }));
vi.mock("./AssetFinancialActions", () => ({ AssetFinancialActions: () => <div data-testid="financial" /> }));
vi.mock("../../../_components/RaiseEOfficeNote", () => ({ RaiseEOfficeNote: (p: { notifyPath?: string }) => <div data-testid="eoffice" data-notify={p.notifyPath ?? ""} /> }));

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

  // fp-assets-02
  it("shows the asset's journal state and the impairment / revaluation accounting banner", async () => {
    getAssetByIdMock.mockResolvedValue({ data: { ...ASSET, glPostStatus: "awaiting_accounts" }, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByText("Awaiting accounts")).toBeInTheDocument();
    expect(screen.getByTestId("accounting-banner")).toHaveAttribute("data-areas", "impairment,revaluation");
  });

  it("shows a dash when no journal applies, and no banner for a terminal asset", async () => {
    getAssetByIdMock.mockResolvedValue({ data: { ...ASSET, status: "disposed" }, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.queryByTestId("accounting-banner")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-LOCATIONS-03
  it("links a registered location to the locations register and shows plain text for a free-text one", async () => {
    getAssetByIdMock.mockResolvedValue({ data: { ...ASSET, location: "Block A", locationId: "loc-1" }, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    const { unmount } = render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByRole("link", { name: "Block A" })).toHaveAttribute("href", "/assets/locations");
    unmount();
    getAssetByIdMock.mockResolvedValue({ data: { ...ASSET, location: "Old store room" }, source: "api", parts: { depreciation: "api", maintenance: "api" } });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByText("Old store room")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Old store room" })).not.toBeInTheDocument();
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

// GAP-ASSETS-DETAIL-05 / DETAIL-08
describe("AssetDetailPage status scope and lifecycle", () => {
  beforeEach(() => { getAssetByIdMock.mockReset(); rolesMock.mockReturnValue(["asset_manager"]); });
  const load = (over: Record<string, unknown>) =>
    getAssetByIdMock.mockResolvedValue({ data: { ...ASSET, ...over }, source: "api", parts: { depreciation: "api", maintenance: "api" } });

  it("offers the financial and eOffice cards for an active asset", async () => {
    load({});
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByTestId("financial")).toBeInTheDocument();
    expect(screen.getByTestId("eoffice")).toBeInTheDocument();
  });

  it("does not pass a notifyPath: the decision returns via asset.disposal.file_decided, and a {} body always 400s", async () => {
    load({});
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByTestId("eoffice").getAttribute("data-notify")).toBe("");
  });

  it.each(["disposed", "written_off", "condemned"])("offers neither the financial nor the eOffice disposal card for a %s asset", async (status) => {
    load({ status });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.queryByTestId("financial")).not.toBeInTheDocument();
    expect(screen.queryByTestId("eoffice")).not.toBeInTheDocument();
  });

  it("does not mark Tagged or AMC done for an untagged asset that only has a warranty", async () => {
    load({ warrantyExpiry: "2027-01-01" });
    const { container } = render(await AssetDetailPage({ params: { id: "a1" } }));
    const stepClass = (label: string) => screen.getByText(label, { selector: ".t" }).closest("li")?.className;
    expect(stepClass("Tagged")).toBe("todo");
    expect(stepClass("AMC")).toBe("todo");
    expect(container.textContent).toMatch(/Warranty until/);
  });

  it("marks Tagged done when the asset has a barcode", async () => {
    load({ barcode: "AST-1-BC" });
    render(await AssetDetailPage({ params: { id: "a1" } }));
    expect(screen.getByText("Tagged", { selector: ".t" }).closest("li")?.className).toBe("done");
  });
});
