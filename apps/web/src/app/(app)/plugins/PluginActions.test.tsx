import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));

import { PluginActions, MarketplaceInstallButton, lifecycleOf } from "./PluginActions";

describe("PluginActions — GAP-PLUGINS-INSTALLED-01 (one primary action per lifecycle)", () => {
  beforeEach(() => mockRefresh.mockClear());

  it("enabled -> Disable only (no Install, no Enable)", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "enabled" }} />);
    expect(screen.getByRole("button", { name: "Disable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
  });

  it("disabled -> Enable only", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "disabled" }} />);
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("available -> Install only (never offered on an enabled plugin)", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "available" }} />);
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
  });

  it("unknown status (error) -> no enable/disable button", () => {
    render(<PluginActions plugin={{ id: "p1", name: "A", status: "error" }} />);
    expect(screen.queryByRole("button", { name: "Enable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Disable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
  });

  it("GAP-PLUGINS-INSTALLED-04: a row with no id shows explanatory text, not dead buttons", () => {
    render(<PluginActions plugin={{ name: "A", status: "enabled" }} />);
    expect(screen.getByText("Not manageable")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("GAP-PLUGINS-INSTALLED-02: canManage=false renders no controls at all", () => {
    const { container } = render(
      <PluginActions plugin={{ id: "p1", name: "A", status: "enabled" }} canManage={false} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe("lifecycleOf", () => {
  it.each([
    ["enabled", "enabled"],
    ["active", "enabled"],
    ["disabled", "disabled"],
    ["available", "available"],
    ["not_installed", "available"],
    ["pending", "other"],
  ])("%s -> %s", (input, expected) => {
    expect(lifecycleOf(input)).toBe(expected);
  });
});

describe("MarketplaceInstallButton — GAP-PLUGINS-MARKETPLACE-01", () => {
  beforeEach(() => mockRefresh.mockClear());

  it("renders an Install control for an uninstalled listing when canManage", () => {
    render(<MarketplaceInstallButton listingId="m1" name="Billing" canManage />);
    expect(screen.getByRole("button", { name: "Install" })).toBeInTheDocument();
  });

  it("shows Installed (no button) for an already-installed listing", () => {
    render(<MarketplaceInstallButton listingId="m1" name="Billing" installed canManage />);
    expect(screen.queryByRole("button", { name: "Install" })).not.toBeInTheDocument();
    expect(screen.getByText("Installed")).toBeInTheDocument();
  });

  it("renders nothing for a non-manager", () => {
    const { container } = render(<MarketplaceInstallButton listingId="m1" name="Billing" canManage={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
