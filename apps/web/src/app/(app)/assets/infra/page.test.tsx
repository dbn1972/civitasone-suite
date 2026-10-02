import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

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
