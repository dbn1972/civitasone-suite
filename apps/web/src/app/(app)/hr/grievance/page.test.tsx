import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Same mocking convention as hr/disciplinary/page.test.tsx: control the
// session role directly at the roleGuard module boundary.
let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import GrievancePage from "./page";

describe("GrievancePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  // GAP-HR-GRIEVANCE-04/05: this page had no role gate of its own before --
  // relied entirely on the API's 403, even though hr/layout.tsx admits
  // manager/employee into /hr and the register's columns are DPDP-sensitive.
  it("shows an honest permission-denied state for a role the backend would reject, and never fetches", async () => {
    mockRoles = ["employee"];
    const ui = await GrievancePage();
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  // GAP-HR-GRIEVANCE-01: GET /v1/hrms/grievances is a permanent stub that
  // always returns { data: [], meta: { note: "..." } } -- this used to be
  // indistinguishable from a real, empty register (four "0" stat cards).
  it("shows an honest 'not yet available' state instead of misleading zero stat cards when the backend reports the register isn't built", async () => {
    fetchJsonMock.mockResolvedValue({
      data: { items: [], notBuilt: true },
      source: "api",
    });

    const ui = await GrievancePage();
    render(ui);

    expect(screen.getByText("Grievance register is not yet available")).toBeInTheDocument();
    // No stat card should show a real "0" -- statValue() returns null (a
    // dash) whenever notBuilt is true.
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("renders the real register and stat counts once the backend actually returns rows", async () => {
    fetchJsonMock.mockResolvedValue({
      data: {
        items: [
          { id: "11111111-1111-1111-1111-111111111111", employee: "A. Kumar", department: "Revenue", category: "Harassment", filedDate: "2026-01-01", assignedTo: "HR Officer", description: "x", status: "opened" },
        ],
        notBuilt: false,
      },
      source: "api",
    });

    const ui = await GrievancePage();
    render(ui);

    expect(screen.queryByText("Grievance register is not yet available")).not.toBeInTheDocument();
    expect(screen.getByText("A. Kumar")).toBeInTheDocument();
  });

  it("shows permission-denied (not a generic retry) for a live 403, via LoadErrorState", async () => {
    // Distinct from the role-gate test above: this covers a role that
    // passes the client-side gate but the backend itself still rejects
    // (e.g. a role-list drift between this page and gap-features/routes.ts).
    fetchJsonMock.mockResolvedValue({
      data: { items: [], notBuilt: false },
      source: "error",
      status: 403,
      errorMessage: undefined,
    });

    const ui = await GrievancePage();
    render(ui);
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
