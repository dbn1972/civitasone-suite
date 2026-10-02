import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getInfraAssetsMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getInfraAssets: () => getInfraAssetsMock() }));

import InfraAssetsPage from "./page";

// GAP-ASSETS-INFRA-01
describe("InfraAssetsPage", () => {
  it("does not show a permanent-zero Needs Repair tile or a Condition column fed by status", async () => {
    getInfraAssetsMock.mockResolvedValue({
      source: "api",
      data: [{ id: "a1", assetCode: "INF-1", name: "Bridge", category: "1a2b3c4d", type: "infra", purchaseDate: "2020-01-01", purchaseCost: 100, currentValue: 90, status: "in_use" }],
    });
    render(await InfraAssetsPage());
    expect(screen.queryByText("Needs Repair")).not.toBeInTheDocument();
    expect(screen.queryByText("Buildings")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Condition/ })).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Status/ })).toBeInTheDocument();
  });
});

describe("InfraAssetsPage failure + labels", () => {
  // GAP-ASSETS-INFRA-02
  it("labels the locations link truthfully (no map exists)", async () => {
    getInfraAssetsMock.mockResolvedValue({ source: "api", data: [] });
    render(await InfraAssetsPage());
    expect(screen.queryByRole("link", { name: "Map view" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Locations" })).toHaveAttribute("href", "/assets/locations");
  });

  // GAP-ASSETS-INFRA-03: Buildings substring tile was removed by the HIGH pass (INFRA-01); pinned.
  it("does not count categories by free-text substring", async () => {
    getInfraAssetsMock.mockResolvedValue({
      source: "api",
      data: [{ id: "a1", assetCode: "INF-1", name: "Hall", category: "Office Building", type: "infra", purchaseDate: "2020-01-01", purchaseCost: 100, currentValue: 90, status: "in_use" }],
    });
    render(await InfraAssetsPage());
    expect(screen.queryByText("Buildings")).not.toBeInTheDocument();
  });

  // GAP-ASSETS-INFRA-04
  it("shows em dashes in the stats and a single error message when the load fails", async () => {
    getInfraAssetsMock.mockResolvedValue({ source: "error", data: [] });
    render(await InfraAssetsPage());
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /try again|retry/i }).length).toBeGreaterThan(0);
  });
});

