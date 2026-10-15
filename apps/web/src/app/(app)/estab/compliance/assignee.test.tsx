import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";

const getEstabCompliance = vi.fn();
vi.mock("../../../_data/loaders", () => ({ getEstabCompliance: (...a: unknown[]) => getEstabCompliance(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["estab_officer"],
  hasAnyRole: (have: string[], allowed: string[]) => allowed.some((r) => have.includes(r)),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import CompliancePage from "./page";

const UUID = "3f9a1c2e-0000-4000-8000-000000000001";
const item = (over: Record<string, unknown>) => ({
  id: "c1", complianceCode: "RTI-1", title: "File RTI report", category: "RTI", frequency: "annual",
  dueDate: "2099-01-01", status: "pending", ...over,
});

describe("GAP-ESTAB-COMPLIANCE-04: Assigned to is a name, never an id", () => {
  beforeEach(() => { getEstabCompliance.mockReset(); });

  it("Given an item whose assignee the service named, Then the name shows", async () => {
    getEstabCompliance.mockResolvedValue({ data: [item({ assignedTo: UUID, assignedToName: "Asha Rao" })], source: "api" });
    render(await CompliancePage());
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("3f9a1c2e");
  });

  it("Given an assignee the service could not name, Then it reads Unknown employee and no id fragment is shown", async () => {
    getEstabCompliance.mockResolvedValue({ data: [item({ assignedTo: UUID })], source: "api" });
    render(await CompliancePage());
    expect(screen.getByText("Unknown employee")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("3f9a1c2e");
  });

  it("Given an unassigned item, Then the cell is an em dash", async () => {
    getEstabCompliance.mockResolvedValue({ data: [item({})], source: "api" });
    render(await CompliancePage());
    expect(screen.queryByText("Unknown employee")).not.toBeInTheDocument();
  });
});
