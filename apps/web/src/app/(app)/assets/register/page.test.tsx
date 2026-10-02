import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAssetCategoriesMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getAssetCategories: () => getAssetCategoriesMock() }));
const rolesMock = vi.fn<() => string[]>(() => ["asset_manager"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
vi.mock("./RegisterAssetForm", () => ({ RegisterAssetForm: () => <form aria-label="register form" /> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import RegisterAssetPage from "./page";

describe("RegisterAssetPage", () => {
  beforeEach(() => { getAssetCategoriesMock.mockReset(); rolesMock.mockReturnValue(["asset_manager"]); });

  it("asks for category setup instead of posting a magic id when no categories exist", async () => {
    getAssetCategoriesMock.mockResolvedValue({ data: [], source: "api" });
    render(await RegisterAssetPage());
    expect(screen.getByText("Category setup required")).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "register form" })).not.toBeInTheDocument();
  });

  it("shows a load error when categories fail to load", async () => {
    getAssetCategoriesMock.mockResolvedValue({ data: [], source: "error" });
    render(await RegisterAssetPage());
    expect(screen.queryByText("Category setup required")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "register form" })).not.toBeInTheDocument();
  });

  it("does not render the form for a role the service would reject", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    render(await RegisterAssetPage());
    expect(screen.getByText("Not permitted")).toBeInTheDocument();
    expect(getAssetCategoriesMock).not.toHaveBeenCalled();
  });

  it("renders the form when categories exist", async () => {
    getAssetCategoriesMock.mockResolvedValue({ data: [{ id: "c1" }], source: "api" });
    render(await RegisterAssetPage());
    expect(screen.getByRole("form", { name: "register form" })).toBeInTheDocument();
  });
});
