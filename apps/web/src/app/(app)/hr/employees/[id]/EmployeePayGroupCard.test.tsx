import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EmployeePayGroupCard } from "./EmployeePayGroupCard";

function withIntl(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

const CURRENT = {
  payGroupId: "g1", payGroupName: "Gazetted Staff", ddoCode: "DDO-1", billType: "gazetted",
  effectiveFrom: "2026-10-01", effectiveTo: null,
};

describe("EmployeePayGroupCard", () => {
  it("shows the current group as a link, with DDO, translated bill type and effective-since date", () => {
    render(withIntl(<EmployeePayGroupCard result={{ source: "api", data: { current: CURRENT, history: [] } }} />));
    expect(screen.getByRole("link", { name: "Gazetted Staff" })).toHaveAttribute("href", "/hr/payroll/pay-groups/g1");
    expect(screen.getByText("DDO-1")).toBeInTheDocument();
    expect(screen.getByText("Gazetted")).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();
  });

  it("says 'Not in any pay group' only when the lookup succeeded with no current group", () => {
    render(withIntl(<EmployeePayGroupCard result={{ source: "api", data: { current: null, history: [] } }} />));
    expect(screen.getByText("Not in any pay group.")).toBeInTheDocument();
  });

  it("a failed lookup is 'unavailable', never 'not in any pay group'", () => {
    render(withIntl(<EmployeePayGroupCard result={{ source: "error", data: null }} />));
    expect(screen.getByText("Pay group details couldn't be loaded right now.")).toBeInTheDocument();
    expect(screen.queryByText("Not in any pay group.")).not.toBeInTheDocument();
  });

  it("lists past memberships under a history disclosure", () => {
    const past = { ...CURRENT, payGroupId: "g0", payGroupName: "Old Group", effectiveFrom: "2025-04-01", effectiveTo: "2026-10-01" };
    render(withIntl(<EmployeePayGroupCard result={{ source: "api", data: { current: CURRENT, history: [past] } }} />));
    expect(screen.getByText("Pay group history")).toBeInTheDocument();
    expect(screen.getByText(/Old Group: .* to .*/)).toBeInTheDocument();
  });
});
