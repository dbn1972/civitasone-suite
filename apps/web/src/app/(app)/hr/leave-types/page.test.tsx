import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const roles = vi.hoisted(() => ({ current: ["employee"] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));
vi.mock("./LeaveTypesClient", () => ({ default: () => <div>leave types screen</div> }));
vi.mock("../../../_components/PermissionDenied", () => ({ PermissionDenied: () => <div>denied</div> }));
import LeaveTypesPage from "./page";

describe("leave types page role gate (mirrors the backend's HR-admin set)", () => {
  it("denies an ordinary employee and an hr_officer", () => {
    for (const r of [["employee"], ["hr_officer"]]) {
      roles.current = r;
      const { unmount } = render(<LeaveTypesPage />);
      expect(screen.getByText("denied")).toBeInTheDocument();
      unmount();
    }
  });
  it("admits hr_admin", () => {
    roles.current = ["hr_admin"];
    render(<LeaveTypesPage />);
    expect(screen.getByText("leave types screen")).toBeInTheDocument();
  });
});
