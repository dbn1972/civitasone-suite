import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => ["hr_admin"] };
});

import { RoleCommandCenter } from "./RoleCommandCenter";

describe("RoleCommandCenter payroll shortcut follows the Payroll switch (M2)", () => {
  it("shows the Payroll run shortcut by default (unchanged)", () => {
    render(<RoleCommandCenter />);
    expect(screen.getByText("Payroll run")).toBeInTheDocument();
    expect(screen.getByText("Leave approvals")).toBeInTheDocument();
  });

  it("hides only the Payroll run shortcut when Payroll is off", () => {
    render(<RoleCommandCenter payrollEnabled={false} />);
    expect(screen.queryByText("Payroll run")).toBeNull();
    expect(screen.getByText("Leave approvals")).toBeInTheDocument();
    expect(screen.getByText("Attendance exceptions")).toBeInTheDocument();
  });
});
