import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { PluginsTable } from "./PluginsTable";
import { PluginCatalogTable } from "./PluginCatalogTable";
import { HooksTable } from "./HooksTable";
import { MarketplaceTable } from "./MarketplaceTable";
import type { PluginCatalogRow, PluginHookRow } from "./_data";

describe("PluginsTable — GAP-PLUGINS-INSTALLED-04 (StatusPill, not binary Enabled/Disabled)", () => {
  it("status 'error' renders 'Error', not 'Disabled'", () => {
    render(<PluginsTable rows={[{ id: "p1", name: "A", status: "error" }]} canManage={false} />);
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.queryByText("Disabled")).not.toBeInTheDocument();
  });
});

describe("PluginCatalogTable — GAP-PLUGINS-REGISTRY-02 / MARKETPLACE-03 / HOOKS-02 (UUID) + CAP", () => {
  const uuid = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

  it("renders StatusPill 'Active' and never prints the 8-char truncated id", () => {
    render(<PluginCatalogTable rows={[{ id: uuid, name: "A", status: "active" }]} />);
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.queryByText(uuid.slice(0, 8))).not.toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("GAP-PLUGINS-*-04/05 CAP: 30 rows paginate to 15 with a pager; filter narrows", () => {
    const rows: PluginCatalogRow[] = Array.from({ length: 30 }, (_, i) => ({
      id: `id-${i}`,
      name: `Plugin ${i}`,
      status: "active",
    }));
    render(<PluginCatalogTable rows={rows} />);
    // 15 of 30 rows shown + a "Page 1 of 2" pager
    expect(screen.getByText("Plugin 0")).toBeInTheDocument();
    expect(screen.queryByText("Plugin 20")).not.toBeInTheDocument();
    expect(screen.getByText(/of/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "Plugin 20" } });
    expect(screen.getByText("Plugin 20")).toBeInTheDocument();
    expect(screen.queryByText("Plugin 0")).not.toBeInTheDocument();
  });
});

describe("HooksTable — GAP-PLUGINS-HOOKS-01 (owner + failures columns)", () => {
  it("shows owner plugin and a warning pill for failures > 0", () => {
    const rows: PluginHookRow[] = [
      { id: "h1", event: "invoice.created", ownerPlugin: "Billing", status: "enabled", failures: 4 },
    ];
    render(<HooksTable rows={rows} />);
    expect(screen.getByText("invoice.created")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Owner plugin")).toBeInTheDocument();
    // failure count rendered as a (warning) pill label
    expect(screen.getByText("4")).toBeInTheDocument();
  });
});

describe("MarketplaceTable — GAP-PLUGINS-MARKETPLACE-01", () => {
  it("renders an Install action per row for a manager", () => {
    const rows: PluginCatalogRow[] = [{ id: "m1", name: "Billing", publisher: "Acme" }];
    render(<MarketplaceTable rows={rows} canManage />);
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });
});
