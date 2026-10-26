/**
 * Q31: a plugin_user whose read-only listing fails must see a permission-aware empty state,
 * not the red refresh/error state. A manager whose registry load fails still sees the error.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
const roles = vi.fn();
vi.mock("@/lib/auth/roleGuard", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard")),
  getSessionRoles: () => roles(),
}));
const registry = vi.fn();
vi.mock("../_data", () => ({ getPluginRegistryCatalog: () => registry() }));
const items = vi.fn();
vi.mock("../../../_data/loaders", async () => ({
  ...(await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders")),
  getPlugins: () => items(),
}));

import Page from "./page";

describe("plugins/installed permission-aware empty state (Q31)", () => {
  beforeEach(() => {
    registry.mockReset();
    items.mockReset();
  });

  it("plugin_user with a failed listing sees an empty state, not an error", async () => {
    roles.mockReturnValue(["plugin_user"]);
    items.mockResolvedValue({ source: "error", data: [], status: 403 });
    render(await Page());
    expect(screen.getByText("No installed plugins to show")).toBeInTheDocument();
    expect(screen.getByText(/Ask a plugin administrator/)).toBeInTheDocument();
    expect(screen.queryByText(/couldn.t load|try again|refresh/i)).not.toBeInTheDocument();
  });

  it("a plugin manager whose registry load fails still sees the error state", async () => {
    roles.mockReturnValue(["plugin_admin"]);
    registry.mockResolvedValue({ source: "error", data: [] });
    render(await Page());
    expect(screen.queryByText("No installed plugins to show")).not.toBeInTheDocument();
  });
});
