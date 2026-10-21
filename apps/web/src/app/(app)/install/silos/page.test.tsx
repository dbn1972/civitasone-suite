import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const data = vi.hoisted(() => ({ getInstallSilos: vi.fn() }));
vi.mock("../_data", () => data);

const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn(() => ["install_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  ...auth,
}));

const { default: Page } = await import("./page");

beforeEach(() => {
  vi.clearAllMocks();
  data.getInstallSilos.mockResolvedValue({
    source: "api",
    data: [{ id: "s1", label: "OFFICE-A", status: "ready" }],
  });
});

describe("Silo provisions page (GAP-INSTALL-SILOS-04)", () => {
  it("shows the forbidden state and never fetches for a non-reader", async () => {
    auth.getSessionRoles.mockReturnValue(["employee"]);
    render(await Page());
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText("OFFICE-A")).not.toBeInTheDocument();
    expect(data.getInstallSilos).not.toHaveBeenCalled();
  });

  it("denies tenant_admin, which the silo-provisions API also 403s", async () => {
    auth.getSessionRoles.mockReturnValue(["tenant_admin"]);
    render(await Page());
    expect(data.getInstallSilos).not.toHaveBeenCalled();
  });

  it("lists provisions for install_admin", async () => {
    auth.getSessionRoles.mockReturnValue(["install_admin"]);
    render(await Page());
    expect(data.getInstallSilos).toHaveBeenCalled();
    expect(screen.getByText("OFFICE-A")).toBeInTheDocument();
  });
});
