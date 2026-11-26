import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const render = (ui: ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
// The form searches employees through EntityPicker; this test is about the page gate.
vi.mock("./NewDeputationForm", () => ({ NewDeputationForm: () => <div data-testid="new-deputation-form" /> }));

import NewDeputationPage from "./page";

describe("/hr/deputation/new page (GAP-HR-DEPUTATION-02)", () => {
  beforeEach(() => { mockRoles = []; });

  it.each(["hr_admin", "hr_officer", "super_admin"])("%s sees the form", async (role) => {
    mockRoles = [role];
    render(await NewDeputationPage());
    expect(screen.getByTestId("new-deputation-form")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "New Deputation" })).toBeInTheDocument();
  });

  it.each(["manager", "employee", "payroll_admin", "vigilance_officer"])("%s is refused (HR_ROLES-gated, like the API)", async (role) => {
    mockRoles = [role];
    render(await NewDeputationPage());
    expect(screen.queryByTestId("new-deputation-form")).not.toBeInTheDocument();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
  });

  it("hi carries the same deputationNew keys as en", () => {
    expect(Object.keys((hiMessages as unknown as { deputationNew: object }).deputationNew).sort())
      .toEqual(Object.keys(enMessages.deputationNew).sort());
  });
});
