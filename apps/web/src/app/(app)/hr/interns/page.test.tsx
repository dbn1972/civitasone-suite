import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next-intl/server", async () => {
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, string>>;
  return { getTranslations: async (ns: string) => (key: string) => en[ns]?.[key] ?? key };
});

import InternsPage from "./page";

beforeEach(() => {
  fetchJsonMock.mockReset();
  fetchJsonMock.mockResolvedValue({
    source: "api",
    data: [{ id: "1", name: "Asha Rao", department: "IT", type: "Intern", status: "active" }],
  });
  mockRoles = ["hr_admin"];
});

describe("/hr/interns role gate (GAP-HR-INTERNS-04)", () => {
  it("shows PermissionDenied to a plain employee and never fetches the register", async () => {
    mockRoles = ["employee"];
    render(await InternsPage());
    expect(screen.getByText(/interns register/i)).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).toBeNull();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it.each([["hr_admin"], ["hr_officer"], ["super_admin"], ["manager"]])("lets %s see the register", async (role) => {
    mockRoles = [role];
    render(await InternsPage());
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });
});
