/**
 * plugin_user (admitted by the plugins layout, NOT allowed GET /v1/plugins) must read the
 * /v1/plugins/items listing, never the manager-only registry, and gets no mutating controls.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (k: string) => k }));
vi.mock("@/lib/auth/roleGuard", async () => ({
  ...(await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard")),
  getSessionRoles: () => ["plugin_user"],
}));

const registry = vi.fn();
vi.mock("../_data", () => ({ getPluginRegistryCatalog: () => registry() }));
const items = vi.fn();
vi.mock("../../../_data/loaders", async () => ({
  ...(await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders")),
  getPlugins: () => items(),
}));

import Page from "./page";

describe("plugins/installed page for plugin_user", () => {
  beforeEach(() => {
    registry.mockReset();
    items.mockReset();
  });

  it("reads the items listing, not the manager-only registry, and shows no Enable/Disable", async () => {
    items.mockResolvedValue({ source: "api", data: [{ id: "a", name: "Alpha", status: "enabled" }] });
    render(await Page());
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(registry).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
  });
});
