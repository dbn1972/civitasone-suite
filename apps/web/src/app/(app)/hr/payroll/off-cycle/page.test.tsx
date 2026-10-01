import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
let sessionRoles: string[] = ["payroll_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => sessionRoles,
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => []),
  resolveEmployees: vi.fn(async () => []),
}));

import OffCyclePage from "./page";

// UX-017: OffCyclePage is a server component (translated via
// getTranslations(), which vitest.setup.ts mocks centrally -- no provider
// needed just for that call), but it also renders CreateOffCycleForm and
// OffCycleCards, both CLIENT components that now call useTranslations().
// Those children need a genuine NextIntlClientProvider in the tree once
// rendered for real by testing-library -- same pattern as
// disbursement/page.test.tsx (tranche 9).
async function renderPage() {
  const ui = await OffCyclePage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("OffCyclePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    sessionRoles = ["payroll_admin"];
  });

  it("renders the list of off-cycle runs", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        {
          id: "o1",
          run_type: "bonus",
          period: "2025-06",
          description: "Diwali bonus",
          total_amount_minor: 500000,
          total_tax_minor: 0,
          total_net_minor: 0,
          status: "draft",
          created_at: "2025-06-01T00:00:00Z",
        },
      ],
      source: "api",
    });

    await renderPage();

    // "Diwali bonus" renders as part of a longer text node ("Period:
    // <strong>2025-06</strong> · Diwali bonus"), not as an isolated string --
    // match by substring instead of exact text.
    expect(screen.getByText((_, el) => el?.textContent === "Period: 2025-06 · Diwali bonus")).toBeInTheDocument();
    expect(screen.getByText("2025-06")).toBeInTheDocument();
  });

  it("renders an empty state when there are no off-cycle runs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });

    await renderPage();

    expect(screen.getByText("No off-cycle runs yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });

    await renderPage();

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  const DRAFT = {
    id: "o1", run_type: "bonus", period: "2025-06", description: null, total_amount_minor: 500000,
    total_tax_minor: 0, total_net_minor: 0, status: "draft", created_at: "2025-06-01T00:00:00Z", employee_count: 2,
  };

  it("GAP-PAYROLL-OFF-CYCLE-06: an employee gets Access restricted, no fetch, no form", async () => {
    sessionRoles = ["employee"];
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Create Off-Cycle Run")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-OFF-CYCLE-06: a read-only reader sees runs but no form and no Process button", async () => {
    sessionRoles = ["finance_officer"];
    fetchJsonMock.mockResolvedValue({ data: [DRAFT], source: "api" });
    await renderPage();
    expect(screen.getByText("Bonus Disbursement")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Process/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Off-Cycle Run" })).not.toBeInTheDocument();
  });

  it("payroll admins get the create form and the Process button", async () => {
    fetchJsonMock.mockResolvedValue({ data: [DRAFT], source: "api" });
    await renderPage();
    expect(screen.getByRole("button", { name: "Create Off-Cycle Run" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Process Bonus Disbursement run/ })).toBeInTheDocument();
  });
});
