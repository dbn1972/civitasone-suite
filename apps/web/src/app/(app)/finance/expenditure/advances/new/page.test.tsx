import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const roles = vi.hoisted(() => ({ current: [] as string[] }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => roles.current }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import NewAdvancePage from "./page";

const renderPage = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><NewAdvancePage /></NextIntlClientProvider>);

// GAP-FINANCE-EXPENDITURE-ADVANCES-NEW-03: the officer picker is offered only to roles payroll-service lets search.
describe("NewAdvancePage role wrapper", () => {
  beforeEach(() => { roles.current = []; });

  it.each(["finance_officer", "super_admin", "payroll_admin", "payroll_officer", "hr_admin"])("%s gets the officer picker", (role) => {
    roles.current = [role];
    renderPage();
    expect(screen.queryByText(/Your role cannot search the employee directory/)).not.toBeInTheDocument();
    expect(screen.getByText(/Search and pick the payee/)).toBeInTheDocument();
  });

  it("finance_admin (can create advances, cannot search employees) gets a typed officer name", () => {
    roles.current = ["finance_admin"];
    renderPage();
    expect(screen.getByText(/Your role cannot search the employee directory/)).toBeInTheDocument();
  });

  it("a session with no roles gets the typed fallback rather than a picker that would 403", () => {
    renderPage();
    expect(screen.getByText(/Your role cannot search the employee directory/)).toBeInTheDocument();
  });
});
