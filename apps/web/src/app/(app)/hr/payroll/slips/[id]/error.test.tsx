import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const identityMock = vi.fn();
vi.mock("@/lib/auth/useSessionIdentity", () => ({ useSessionIdentity: () => identityMock() }));

import ErrorBoundary from "./error";
import { slipBackTarget } from "./_backTarget";

// GAP-PAYROLL-SLIPS-DETAIL-06: the slip route's error boundary must send each role to a page it
// can open -- the same target the page header uses -- not a hard-coded /hr/payroll for everyone.
function renderBoundary(messages: Record<string, unknown> = enMessages, locale = "en") {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages as never}>
      <ErrorBoundary error={new Error("boom")} reset={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("slips/[id] error boundary", () => {
  beforeEach(() => identityMock.mockReset());

  it("sends a payroll admin back to the salary-slips list", () => {
    identityMock.mockReturnValue({ loaded: true, userId: "u1", roles: ["payroll_admin"] });
    renderBoundary();
    expect(screen.getByRole("link", { name: "Back to Salary Slips" })).toHaveAttribute("href", "/hr/payroll/salary-slips");
  });

  it("sends an employee to My payslips -- never /hr/payroll, which says Access restricted to them", () => {
    identityMock.mockReturnValue({ loaded: true, userId: "u2", roles: ["employee"] });
    renderBoundary();
    const link = screen.getByRole("link", { name: "Back to My Payslips" });
    expect(link).toHaveAttribute("href", "/hr/payroll/my-slips");
    expect(screen.queryByRole("link", { name: "Back to Payroll" })).not.toBeInTheDocument();
  });

  it("before the session has answered (no roles yet) it uses the target every slip viewer may open", () => {
    identityMock.mockReturnValue({ loaded: false, userId: null, roles: [] });
    renderBoundary();
    expect(screen.getByRole("link", { name: "Back to My Payslips" })).toHaveAttribute("href", "/hr/payroll/my-slips");
  });

  it("is localised: the back label and the buttons come from the Hindi catalogue, not English literals", async () => {
    identityMock.mockReturnValue({ loaded: true, userId: "u1", roles: ["payroll_admin"] });
    renderBoundary(hiMessages, "hi");
    await waitFor(() => expect(screen.getByRole("link", { name: "वेतन पर्चियों पर वापस जाएं" })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "पुनः प्रयास करें" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "सहायता खोलें" })).toBeInTheDocument();
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
    expect(screen.queryByText("Back to Salary Slips")).not.toBeInTheDocument();
  });
});

describe("slipBackTarget", () => {
  it.each([
    [["payroll_admin"], "/hr/payroll/salary-slips"],
    [["payroll_officer"], "/hr/payroll/salary-slips"],
    [["super_admin"], "/hr/payroll/salary-slips"],
    [["finance_officer"], "/hr/payroll/salary-slips"],
    [["hr_admin"], "/hr/payroll/salary-slips"],
    [["employee"], "/hr/payroll/my-slips"],
    [["employee", "manager"], "/hr/payroll/my-slips"],
    [[], "/hr/payroll/my-slips"],
  ])("roles %j -> %s", (roles, href) => {
    expect(slipBackTarget(roles).href).toBe(href);
  });

  it("an admin who is also an employee gets the admin list", () => {
    expect(slipBackTarget(["employee", "payroll_admin"]).labelKey).toBe("backToSalarySlips");
  });
});
