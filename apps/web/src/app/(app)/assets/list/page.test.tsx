import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../../_data/loaders", () => ({
  getAssets: async () => ({ data: [], source: "api" }),
  getFixedAssets: async () => ({ data: [], source: "api" }),
}));
vi.mock("./AssetsTable", () => ({ AssetsTable: () => null }));
vi.mock("../list/AssetsTable", () => ({ AssetsTable: () => null }));

import AssetListPage from "./page";
import FixedAssetsPage from "../fixed-assets/page";

// GAP-ASSETS-LIST-01 / GAP-ASSETS-FIXED-ASSETS-01
describe("register titles", () => {
  it("the all-types list is the Asset Register; fixed-assets keeps Fixed Asset Register", async () => {
    const { unmount } = render(await AssetListPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^Asset Register$/);
    expect(screen.queryByText(/Auto-capitalised from Procurement GRN/)).not.toBeInTheDocument();
    unmount();
    render(await FixedAssetsPage());
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Fixed Asset Register");
  });
});
