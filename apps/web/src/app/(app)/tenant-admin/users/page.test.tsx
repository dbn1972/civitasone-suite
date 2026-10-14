import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAdminUsersMock = vi.fn();
vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  return { ...actual, getAdminUsers: (...a: unknown[]) => getAdminUsersMock(...a) };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, seed: unknown, source: string) => ({
    data: seed, provenance: source === "error" ? "error-no-data" : "live", offline: false, cachedAt: null,
  }),
}));

import AdminUsersPage from "./page";
import { ToastProvider } from "@/app/_components/ds";

const tile = (label: string) => screen.getAllByText(label).map((el) => el.closest(".stat")).find((el) => el !== null) as HTMLElement;
const renderPage = async () => render(<ToastProvider>{await AdminUsersPage()}</ToastProvider>);

describe("AdminUsersPage — FAILMASK (GAP-TENANT-ADMIN-USERS-02)", () => {
  beforeEach(() => getAdminUsersMock.mockReset());

  it("a failed load shows '—' tiles and a retry error state, not zeros", async () => {
    getAdminUsersMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    for (const label of ["Total Users", "Active", "Suspended", "MFA Enabled"]) expect(tile(label)).toHaveTextContent("—");
    expect(screen.getByText(/couldn't load users/i)).toBeInTheDocument();
  });

  it("a genuine empty directory still shows real zeros", async () => {
    getAdminUsersMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(tile("Total Users")).toHaveTextContent("0");
    expect(screen.queryByText(/couldn't load users/i)).not.toBeInTheDocument();
  });

  it("has no unaudited window.print() Export button in the header (USERS-05)", async () => {
    getAdminUsersMock.mockResolvedValue({ data: [{ id: "u1", name: "Asha", email: "a@dept.gov.in", roles: [], mfaEnabled: true, status: "active" }], source: "api" });
    await renderPage();
    expect(screen.queryByRole("button", { name: /^Export$/ })).not.toBeInTheDocument();
  });
});
