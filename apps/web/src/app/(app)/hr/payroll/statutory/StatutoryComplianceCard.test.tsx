import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { StatutoryComplianceCard } from "./StatutoryComplianceCard";

// GAP-PAYROLL-STATUTORY-03 / -05: the ceiling used to render "No ceiling"
// for a state-specific scheme (PT/LWF) exactly the same as a scheme with no
// ceiling at all (NPS/GPF) -- a discriminated value fixes that. The card
// itself moved from a plain <a> (full page reload, JS-only hover) to
// next/link with CSS-driven hover/focus (see civitas-ds.css's
// .statutory-card rule).
function renderCard(props: Partial<React.ComponentProps<typeof StatutoryComplianceCard>> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <StatutoryComplianceCard
        label="Provident Fund"
        icon="🏦"
        empPct={12}
        erPct={12}
        challanDueDay={15}
        href="/hr/payroll/statutory/pf"
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

describe("StatutoryComplianceCard", () => {
  it("renders a state-specific ceiling as 'State-specific', not 'No ceiling'", () => {
    renderCard({ wageCeilingMonthly: "state" });
    expect(screen.getByText("State-specific")).toBeInTheDocument();
    expect(screen.queryByText("No ceiling")).not.toBeInTheDocument();
  });

  it("renders 'No ceiling' for a scheme with genuinely no ceiling", () => {
    renderCard({ wageCeilingMonthly: "none" });
    expect(screen.getByText("No ceiling")).toBeInTheDocument();
  });

  it("renders 'No ceiling' when the ceiling is simply omitted (back-compat)", () => {
    renderCard({});
    expect(screen.getByText("No ceiling")).toBeInTheDocument();
  });

  it("renders a numeric ceiling as formatted rupees", () => {
    renderCard({ wageCeilingMonthly: 1_500_000 });
    expect(screen.getByText("₹15,000 /mo")).toBeInTheDocument();
  });

  it("renders a client-navigable link (next/link), not a plain reload anchor, with the hover/focus CSS class", () => {
    renderCard({ href: "/hr/payroll/statutory/pf" });
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/hr/payroll/statutory/pf");
    expect(link).toHaveClass("statutory-card");
  });
});
