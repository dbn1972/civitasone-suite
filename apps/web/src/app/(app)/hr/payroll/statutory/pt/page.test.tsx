import { describe, it, expect, vi, beforeEach } from "vitest";

// Role gate (see the page's own GAP comment): default every test to an
// authorized payroll role; the gate tests below override per call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn((): string[] => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/roleGuard")>()),
  getSessionRoles: getSessionRolesMock,
}));
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

import ProfessionalTaxPage from "./page";

// UX-017: ProfessionalTaxPage (Server Component, getTranslations("pt")) also
// renders PtSlabForm, a "use client" component that calls
// useTranslations("ptSlabForm") -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("ProfessionalTaxPage", () => {
  beforeEach(() => {
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
    fetchJsonMock.mockReset();
  });

  it("renders PT slabs", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ state_code: "KA", slab_from_minor: 0, slab_to_minor: 1500000, pt_amount_minor: 0 }],
      source: "api",
    });
    const ui = await ProfessionalTaxPage();
    renderPage(ui);
    expect(screen.getByText("KA")).toBeInTheDocument();
  });

  it("renders an empty state when there are no PT slabs", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await ProfessionalTaxPage();
    renderPage(ui);
    expect(screen.getByText("No PT slabs configured")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-PT-01: shows Access restricted to employee/manager without calling the API", async () => {
    getSessionRolesMock.mockReturnValue(["employee", "manager"]);
    const ui = await ProfessionalTaxPage();
    renderPage(ui);
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-STATUTORY-PT-01: a read-only role (hr_admin) sees the ledger but not the write form", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await ProfessionalTaxPage();
    renderPage(ui);
    expect(screen.queryByText("Add / Update PT Slab")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-STATUTORY-PT-01: a payroll role sees the write form", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await ProfessionalTaxPage();
    renderPage(ui);
    expect(screen.getByText("Add / Update PT Slab")).toBeInTheDocument();
  });
});
