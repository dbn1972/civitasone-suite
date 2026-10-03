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

const EMP = { id: "1", name: "Asha Rao", department: "IT", employeeType: "intern", status: "active" };

function mockFetches(opts: { apprFail?: boolean; extraEmps?: unknown[]; appr?: unknown[] }) {
  fetchJsonMock.mockImplementation(async (url: string, fallback: unknown, o: { mapResponse?: (p: unknown) => unknown }) => {
    if (String(url).includes("/apprenticeships")) {
      if (opts.apprFail) return { source: "error", data: fallback };
      return { source: "api", data: o.mapResponse ? o.mapResponse({ data: opts.appr ?? [] }) : [] };
    }
    return { source: "api", data: o.mapResponse ? o.mapResponse({ data: [EMP, ...(opts.extraEmps ?? [])] }) : [] };
  });
}

beforeEach(() => {
  fetchJsonMock.mockReset();
  mockFetches({});
  mockRoles = ["hr_admin"];
});

describe("/hr/interns role gate (GAP-HR-INTERNS-04)", () => {
  it("shows PermissionDenied to a plain employee and never fetches the register", async () => {
    mockRoles = ["employee"];
    render(await InternsPage());
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).toBeNull();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it.each([["hr_admin"], ["hr_officer"], ["super_admin"], ["manager"]])("lets %s see the register", async (role) => {
    mockRoles = [role];
    render(await InternsPage());
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });
});

describe("/hr/interns stipend + period (GAP-HR-WORKFORCE-INTERNS-01)", () => {
  it("shows the apprentice's monthly stipend from paise as rupees and the training period", async () => {
    mockFetches({
      extraEmps: [{ id: "2", name: "Ravi Kumar", department: "Works", employeeType: "apprentice", status: "active" }],
      appr: [{ apprenticeId: "2", monthlyStipendMinor: "850000", trainingStart: "2026-01-05", trainingEnd: "2026-12-31", status: "active" }],
    });
    render(await InternsPage());
    expect(screen.getByText("₹8,500.00")).toBeInTheDocument();
    expect(screen.getByText(/05 Jan 2026/)).toBeInTheDocument();
  });

  it("says details are unavailable (never a fabricated amount) when the apprenticeship read fails", async () => {
    mockFetches({ apprFail: true });
    render(await InternsPage());
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/couldn.t be loaded/i);
  });
});
