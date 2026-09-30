import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ToastProvider } from "@/app/_components/ds";

const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["hr_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("@/app/_data/loaders", () => ({
  getEmployeeById: vi.fn(async () => ({ data: null })),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import RetirementPage from "./page";

async function renderPage(props: Parameters<typeof RetirementPage>[0] = {}) {
  const page = await RetirementPage(props);
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>{page}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

function row(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "sep-1",
    employee: "Priya Nair",
    department: "Finance",
    designation: "Section Officer",
    superannuationDate: "2027-01-01",
    separationType: "retirement",
    status: "initiated",
    joiningDate: "1995-01-01",
    ...overrides,
  };
}

// GAP-HR-RETIREMENT-06: no client-side role check existed at all.
describe("RetirementPage role gate (GAP-HR-RETIREMENT-06)", () => {
  it("shows PermissionDenied for a plain employee and issues no fetch", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders normally for hr_officer", async () => {
    getSessionRolesMock.mockReturnValue(["hr_officer"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByRole("heading", { name: "Retirement & Separation" })).toBeInTheDocument();
  });
});

describe("RetirementPage stats (GAP-HR-RETIREMENT-03)", () => {
  it("counts lowercase 'vrs' correctly (was compared against uppercase 'VRS', always 0)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: [row({ id: "s1", separationType: "vrs" }), row({ id: "s2", separationType: "retirement" })],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("VRS").closest(".stat")).toHaveTextContent("1");
  });

  it("shows an 'Initiated' stat (not 'Processed', which nothing ever sets to 'completed')", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({
      data: [row({ id: "s1", status: "initiated" }), row({ id: "s2", status: "initiated" })],
      source: "api",
    });
    await renderPage();
    // "Initiated" also appears per-row in the register's status column, so
    // scope to the stat-grid label specifically (rendered before the
    // register in document order).
    expect(screen.getAllByText("Initiated")[0].closest(".stat")).toHaveTextContent("2");
  });
});
