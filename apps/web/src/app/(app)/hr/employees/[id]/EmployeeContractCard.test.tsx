import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import axe from "axe-core";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { EmployeeContractCard, daysUntil } from "./EmployeeContractCard";

function withIntl(ui: React.ReactNode, locale: "en" | "hi" = "en") {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      {ui}
    </NextIntlClientProvider>
  );
}

const day = (n: number) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const EMP = {
  contractId: "c1", contractStatus: "expiring", contractStartDate: "2026-04-01", contractEndDate: day(12),
  contractRenewalCount: 1, projectCode: "NIC-EGOV-014", projectName: "National e-Governance Gateway",
};

describe("EmployeeContractCard", () => {
  it("renders nothing for a record without a contract (an existing tenant's profile is unchanged)", () => {
    const { container } = render(withIntl(<EmployeeContractCard employee={{}} />));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows status, dates, renewal count, days left, project, project manager and cost centre", () => {
    render(withIntl(<EmployeeContractCard employee={EMP} projectManagerName="Rajesh Iyer" costCenterName="PMU - Delhi" />));
    expect(screen.getByText("Contract and project")).toBeInTheDocument();
    expect(screen.getByText("Expiring")).toBeInTheDocument();
    expect(screen.getByText("NIC-EGOV-014 - National e-Governance Gateway")).toBeInTheDocument();
    expect(screen.getByText("Rajesh Iyer")).toBeInTheDocument();
    expect(screen.getByText("PMU - Delhi")).toBeInTheDocument();
    expect(screen.getByText("12 days left")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("an overdue in-force contract says how many days over; an expired one shows no countdown", () => {
    const { rerender } = render(withIntl(<EmployeeContractCard employee={{ ...EMP, contractStatus: "escalated", contractEndDate: day(-3) }} />));
    expect(screen.getByText("3 days past end date")).toBeInTheDocument();
    rerender(withIntl(<EmployeeContractCard employee={{ ...EMP, contractStatus: "expired", contractEndDate: day(-3) }} />));
    expect(screen.queryByText(/days/)).not.toBeInTheDocument();
  });

  it("is available in Hindi", () => {
    render(withIntl(<EmployeeContractCard employee={EMP} />, "hi"));
    expect(screen.queryByText("Contract and project")).not.toBeInTheDocument();
    expect(screen.getByText(hiMessages.employeeContract.title)).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = render(withIntl(<EmployeeContractCard employee={EMP} projectManagerName="Rajesh Iyer" />));
    const results = await axe.run(container);
    expect(results.violations).toHaveLength(0);
  });
});

describe("daysUntil", () => {
  it("counts calendar days", () => {
    expect(daysUntil("2026-11-17", new Date("2026-11-10T08:00:00Z"))).toBe(7);
    expect(daysUntil("2026-11-10", new Date("2026-11-10T23:00:00Z"))).toBe(0);
    expect(daysUntil("2026-11-08", new Date("2026-11-10T01:00:00Z"))).toBe(-2);
  });
});
