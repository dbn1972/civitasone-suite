import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP2-SHELL-MODULEGATE-01 — ModuleGate must forward the session roles to
 * isModuleEnabled so the documented super_admin/platform_admin bypass applies at
 * the server-side module gate. On main ModuleGate called isModuleEnabled with no
 * roles argument, so a platform operator viewing a module their tenant has disabled
 * got the "Module Not Enabled" wall. These assertions fail on the old code.
 */

let enabled: string[] | null;
let roles: string[];

vi.mock("@/lib/moduleVisibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/moduleVisibility")>();
  return {
    ...actual,
    getEnabledModules: () => Promise.resolve(enabled),
    // keep the REAL isModuleEnabled so the roles-threading is exercised end to end
  };
});

vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => roles,
}));

import { ModuleGate } from "./ModuleGate";

beforeEach(() => {
  enabled = ["finance"]; // tenant has only finance enabled
  roles = [];
});

describe("ModuleGate role-aware gating", () => {
  it("renders the module page for a super_admin even when the tenant disabled it", async () => {
    roles = ["super_admin"];
    const ui = await ModuleGate({ moduleKey: "procurement", children: <div>PROCUREMENT PAGE</div> });
    render(ui);
    expect(screen.getByText("PROCUREMENT PAGE")).toBeInTheDocument();
    expect(screen.queryByText("Module Not Enabled")).not.toBeInTheDocument();
  });

  it("renders the module page for a platform_admin even when the tenant disabled it", async () => {
    roles = ["platform_admin"];
    const ui = await ModuleGate({ moduleKey: "legal", children: <div>LEGAL PAGE</div> });
    render(ui);
    expect(screen.getByText("LEGAL PAGE")).toBeInTheDocument();
  });

  it("still blocks a regular tenant_admin on a disabled module", async () => {
    roles = ["tenant_admin"];
    const ui = await ModuleGate({ moduleKey: "procurement", children: <div>PROCUREMENT PAGE</div> });
    render(ui);
    expect(screen.getByText("Module Not Enabled")).toBeInTheDocument();
    expect(screen.queryByText("PROCUREMENT PAGE")).not.toBeInTheDocument();
  });
});
