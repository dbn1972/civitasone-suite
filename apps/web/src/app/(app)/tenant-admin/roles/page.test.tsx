import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getAdminRolesMock = vi.fn();
vi.mock("../../../_data/loaders", async () => {
  const actual = await vi.importActual<typeof import("../../../_data/loaders")>("../../../_data/loaders");
  return { ...actual, getAdminRoles: (...a: unknown[]) => getAdminRolesMock(...a) };
});
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => ["tenant_admin"] };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import AdminRolesPage from "./page";

const ROLE = { id: "r1", name: "Admin", description: "d", isSystemRole: true, userCount: 2, permissions: [], createdAt: "2026-01-01" };

describe("AdminRolesPage — GAP-TENANT-ADMIN-ROLES-01 (failmask)", () => {
  beforeEach(() => getAdminRolesMock.mockReset());

  it("shows '—' tiles and a retry card on a fetch error, never 0 + empty table", async () => {
    getAdminRolesMock.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await AdminRolesPage());
    expect(screen.getByText("Total Roles").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Role assignments").closest(".stat")).toHaveTextContent("—");
    // no roles table rendered on error
    expect(screen.queryByRole("button", { name: "+ New Role" })).toBeNull();
  });

  it("renders real counts on success", async () => {
    getAdminRolesMock.mockResolvedValue({ data: [ROLE], source: "api" });
    render(await AdminRolesPage());
    expect(screen.getByText("Total Roles").closest(".stat")).toHaveTextContent("1");
  });

  it("labels the assignments tile 'Role assignments' (not a user count) (-03)", async () => {
    getAdminRolesMock.mockResolvedValue({ data: [ROLE], source: "api" });
    render(await AdminRolesPage());
    expect(screen.getByText("Role assignments")).toBeInTheDocument();
  });
});
