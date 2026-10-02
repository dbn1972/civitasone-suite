import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RoleFeaturesManager } from "./RoleFeaturesManager";
import type { AdminRoleSummary, RoleFeatureGrant } from "@/app/_data/loaders";

const roles: AdminRoleSummary[] = [{ id: "r1", key: "hr_admin", name: "HR Admin", description: null, isSystem: false }];

// GAP-ADMIN-ROLE-FEATURES-02
describe("RoleFeaturesManager orphan grants", () => {
  beforeEach(() => vi.restoreAllMocks());

  const grants: RoleFeatureGrant[] = [
    { id: "g1", roleName: "hr_admin", featureKey: "hrms.leave", granted: true },
    { id: "g2", roleName: "hr_admin", featureKey: "legacy.thing", granted: true },
    { id: "g3", roleName: "ghost_role", featureKey: "hrms.leave", granted: true },
  ];

  it("renders a row, with a checked box, for a granted feature that is not in the catalogue", () => {
    render(<RoleFeaturesManager roles={roles} initialGrants={grants} source="api" />);
    expect(screen.getByText("legacy.thing")).toBeInTheDocument();
    expect(screen.getByText("not in catalogue")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "HR Admin access to legacy.thing" })).toBeChecked();
  });

  it("'Active grants' equals the ticks the matrix can show, and unlisted-role grants are noted separately", () => {
    render(<RoleFeaturesManager roles={roles} initialGrants={grants} source="api" />);
    const checked = screen.getAllByRole("checkbox").filter((c) => (c as HTMLInputElement).checked).length;
    expect(screen.getByText("Active grants").parentElement).toHaveTextContent(String(checked));
    expect(checked).toBe(2);
    expect(screen.getByRole("note")).toHaveTextContent("1 more active grant belongs to roles that are not listed");
  });

  it("unchecking an orphan revokes it by its grant id", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<RoleFeaturesManager roles={roles} initialGrants={grants} source="api" />);
    fireEvent.click(screen.getByRole("checkbox", { name: "HR Admin access to legacy.thing" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(String(spy.mock.calls[0]![0])).toBe("/api/proxy/v1/policy/role-features/g2");
    expect((spy.mock.calls[0]![1] as RequestInit).method).toBe("DELETE");
  });
});
