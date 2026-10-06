import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const redirectMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: (to: string) => redirectMock(to),
}));

// Control the session roles the layout/hub read.
let sessionRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return {
    ...actual,
    getSessionRoles: () => sessionRoles,
    // requireAnyRole in the real module closes over the real getSessionRoles,
    // so override it here to read our controllable sessionRoles and call the
    // mocked next/navigation redirect.
    requireAnyRole: (allowed: string[], redirectTo = "/dashboard") => {
      if (!allowed.some((r) => sessionRoles.includes(r))) redirectMock(redirectTo);
    },
  };
});

import { ModuleHub } from "../../_components/ModuleHub";
import PluginsLayout from "./layout";

describe("ModuleHub columns — GAP-PLUGINS-HOME-02", () => {
  it("columns='four' renders the g-4 grid so four tiles sit in one row", () => {
    const { container } = render(
      <ModuleHub
        title="Plugins"
        description="d"
        columns="four"
        links={[
          { href: "/a", label: "A" },
          { href: "/b", label: "B" },
          { href: "/c", label: "C" },
          { href: "/d", label: "D" },
        ]}
      />,
    );
    expect(container.querySelector(".grid.g-4")).toBeTruthy();
    expect(container.querySelector(".grid.g-3")).toBeFalsy();
  });

  it("default stays g-3 (existing hubs unaffected)", () => {
    const { container } = render(
      <ModuleHub title="X" description="d" links={[{ href: "/a", label: "A" }]} />,
    );
    expect(container.querySelector(".grid.g-3")).toBeTruthy();
  });
});

describe("PluginsLayout gate — GAP-PLUGINS-HOME-01 / INSTALLED-02 (ROLEGATE)", () => {
  beforeEach(() => redirectMock.mockClear());

  it("redirects a user with no plugin role to /dashboard", () => {
    sessionRoles = ["employee"];
    render(<PluginsLayout>{null}</PluginsLayout>);
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });

  it("admits a plugin_admin without redirect", () => {
    sessionRoles = ["plugin_admin"];
    redirectMock.mockClear();
    render(<PluginsLayout>{null}</PluginsLayout>);
    expect(redirectMock).not.toHaveBeenCalled();
  });
});
