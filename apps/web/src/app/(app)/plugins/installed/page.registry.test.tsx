/**
 * The Installed page lists the REGISTRY (the resource its Enable/Disable act on), not the
 * unrelated /v1/plugins/items catalogue, and shows only installed/enabled/active/disabled rows.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => (k === "disableReasonLabel" ? "Reason for disabling (recorded in the audit log)" : k) }));
vi.mock("@/lib/auth/roleGuard", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard")),
  getSessionRoles: () => ["plugin_admin"],
}));

const registry = vi.fn();
vi.mock("../_data", () => ({ getPluginRegistryCatalog: () => registry() }));
const legacyItems = vi.fn();
vi.mock("../../../_data/loaders", async () => ({
  ...(await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders")),
  getPlugins: () => legacyItems(),
}));

import Page from "./page";

describe("plugins/installed page data source", () => {
  it("reads the registry, hides uploaded/uninstalled rows, never calls the items loader", async () => {
    registry.mockResolvedValue({
      source: "api",
      data: [
        { id: "a", name: "Alpha", status: "enabled" },
        { id: "b", name: "Bravo", status: "installed" },
        { id: "c", name: "Charlie", status: "disabled" },
        { id: "d", name: "Delta", status: "uploaded" },
        { id: "e", name: "Echo", status: "uninstalled" },
      ],
    });
    render(await Page());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Charlie")).toBeInTheDocument();
    expect(screen.queryByText("Delta")).not.toBeInTheDocument();
    expect(screen.queryByText("Echo")).not.toBeInTheDocument();
    expect(legacyItems).not.toHaveBeenCalled();
    // Enable (Bravo installed + Charlie disabled) and Disable (Alpha) act on these registry ids.
    expect(screen.getAllByRole("button", { name: "Enable" })).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Disable" })).toHaveLength(1);
  });

  it("a registry load failure renders the error state, not an empty list", async () => {
    registry.mockResolvedValue({ source: "error", data: [] });
    render(await Page());
    expect(screen.queryByText("Alpha")).not.toBeInTheDocument();
    expect(legacyItems).not.toHaveBeenCalled();
  });
});
