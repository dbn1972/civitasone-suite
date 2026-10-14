import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...args: unknown[]) => fetchJsonMock(...args) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const roles = vi.hoisted(() => ({ value: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", async (orig) => ({ ...(await orig<typeof import("@/lib/auth/roleGuard")>()), getSessionRoles: () => roles.value }));
vi.mock("@/lib/estab/useEstabDivisions", () => ({ useEstabDivisions: () => ({ loaded: true, failed: false, divisions: ["ADMIN"] }) }));

import QuartersPage from "./page";

describe("QuartersPage — GAP-ESTAB-QUARTERS-03 (create is estab-officer only)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    fetchJsonMock.mockImplementation((_p: string, empty: unknown) => Promise.resolve({ data: empty, source: "api" }));
  });

  it("Given an estab officer, Then the Add Quarter form is shown", async () => {
    roles.value = ["estab_officer"];
    render(await QuartersPage());
    expect(screen.getByRole("button", { name: "Add Quarter" })).toBeInTheDocument();
  });

  it("Given an audit officer (read-only) or an employee, Then there is no Add Quarter form", async () => {
    for (const role of ["audit_officer", "employee"]) {
      roles.value = [role];
      const { unmount } = render(await QuartersPage());
      expect(screen.queryByRole("button", { name: "Add Quarter" })).not.toBeInTheDocument();
      unmount();
    }
  });
});
