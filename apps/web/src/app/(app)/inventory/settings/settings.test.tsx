import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
vi.mock("@/app/_components/ds", async () => {
  const actual = await vi.importActual<typeof import("@/app/_components/ds")>("@/app/_components/ds");
  return { ...actual, useToast: () => ({ toast }) };
});

const inv = vi.hoisted(() => ({ getInventorySettings: vi.fn() }));
vi.mock("../_data", () => inv);
const auth = vi.hoisted(() => ({ getSessionRoles: vi.fn(() => ["inventory_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  ...auth,
}));

const { QcPolicyToggle } = await import("./QcPolicyToggle");
const { default: SettingsPage } = await import("./page");

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  auth.getSessionRoles.mockReturnValue(["inventory_admin"]);
  inv.getInventorySettings.mockResolvedValue({ source: "api", data: { qcMakerChecker: true } });
  vi.stubGlobal("fetch", fetchMock);
});

describe("QcPolicyToggle (GAP-INVENTORY-GOODS-RETURNS-DETAIL-04)", () => {
  it("PUTs the new value and announces success", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    render(<QcPolicyToggle initial />);
    const box = screen.getByRole("checkbox");
    expect(box).toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/proxy/v1/inventory/settings");
    expect(fetchMock.mock.calls[0][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[0][1].body as string)).toEqual({ qcMakerChecker: false });
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("a failure keeps the old value and shows a plain message, not the status code", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    render(<QcPolicyToggle initial />);
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(screen.getByRole("alert")).not.toHaveTextContent(/500/);
  });
});

describe("settings page access", () => {
  it("shows the toggle to an admin", async () => {
    render(await SettingsPage());
    expect(screen.getByRole("checkbox")).toBeChecked();
  });
  it("shows no control to a role without settings access", async () => {
    auth.getSessionRoles.mockReturnValue(["store_keeper"]);
    render(await SettingsPage());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
  });
  it("a failed load is a load error, never a default-looking toggle", async () => {
    inv.getInventorySettings.mockResolvedValue({ source: "error", status: 503, data: { qcMakerChecker: true } });
    render(await SettingsPage());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});
