import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["payroll_admin"],
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }),
}));

import PayrollPage from "./page";

const MOCK_RUNS = [
  { id: "r1", payPeriod: "2026-08", employeeCount: 40, grossAmount: 400000, netAmount: 360000, status: "paid" },
  { id: "r2", payPeriod: "2026-09", employeeCount: 42, grossAmount: 420000, netAmount: 378000, status: "draft" },
];
const MOCK_STRUCTURES = [{ id: "s1", name: "General" }];

function mockFetchJson(runsResult: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path !== "string") return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/payroll/runs")) return Promise.resolve(runsResult);
    if (path.includes("/payroll/structures")) return Promise.resolve({ data: MOCK_STRUCTURES, source: "api" });
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("PayrollPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders payroll runs and real stat counts on success", async () => {
    mockFetchJson({ data: MOCK_RUNS, source: "api" });
    render(await PayrollPage());
    expect(screen.getByText("Total Runs")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("shows an honest empty state — not fabricated rows — when a tenant genuinely has zero runs", async () => {
    mockFetchJson({ data: [], source: "api" });
    render(await PayrollPage());
    // Stat cards show real zeros, not a dash — this is a real "nothing yet" state.
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("shows the error state and hides the runs table on a real fetch failure (source: error)", async () => {
    mockFetchJson({ data: [], source: "error" });
    render(await PayrollPage());
    expect(screen.getByText("We couldn't load this payroll runs.")).toBeInTheDocument();
    // Stat cards show "—", not a fabricated 0 or a count derived from empty error data.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("does not show the create-payroll-run form as if the tenant just has no structures when the fetch actually failed", async () => {
    mockFetchJson({ data: [], source: "error" });
    render(await PayrollPage());
    expect(screen.queryByText(/No pay structures configured/)).not.toBeInTheDocument();
  });
});
