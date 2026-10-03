import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { GratuityCalculator } from "./GratuityCalculator";

// GAP-PAYROLL-STATUTORY-GRATUITY-05: regression coverage for the switch from
// float-rupee to integer-paise BigInt arithmetic (same formula, see the
// component's own comment) and for the new "estimate only" disclaimer.
function renderCalculator() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <GratuityCalculator />
    </NextIntlClientProvider>,
  );
}

describe("GratuityCalculator", () => {
  it("always shows the estimate-only disclaimer", () => {
    renderCalculator();
    expect(screen.getByText("This is an estimate only. The register above is authoritative.")).toBeInTheDocument();
  });

  it("computes the paise-exact result for 50,000 x 10 years (GAP-PAYROLL-STATUTORY-GRATUITY-05)", () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "10" } });
    // (50000 * 15 / 26) * 10 = 288,461.5384... paise-exact, not float-rounded
    // to the nearest whole rupee (which would have shown "Rs 2,88,462").
    expect(screen.getByText("₹2,88,461.53")).toBeInTheDocument();
  });

  it("caps at the statutory ceiling and shows the capped note", () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "500000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "30" } });
    expect(screen.getByText("₹20,00,000.00")).toBeInTheDocument();
    expect(screen.getByText(/Capped at statutory maximum of ₹20,00,000.00/)).toBeInTheDocument();
  });

  it("clamps an implausible years value (e.g. 1e308) to 60 instead of feeding it to BigInt", () => {
    // A non-finite value (e.g. "1e400" -> Infinity) would make BigInt() throw;
    // the input sanitiser drops that one, so pin the clamp with a finite but
    // absurd value instead. 50,000 x 15/26 x 60 = 17,30,769.23 (below the cap).
    renderCalculator();
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "1e308" } });
    expect(screen.getByText("₹17,30,769.23")).toBeInTheDocument();
  });

  it("states the ceiling in its description from the shared constant", () => {
    renderCalculator();
    expect(screen.getByText(/Maximum: ₹20,00,000\.00\./)).toBeInTheDocument();
  });

  it("counts a fraction of a year over six months as a full year (GAP-PAYROLL-STATUTORY-GRATUITY-03)", () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "9.67" } }); // 9y 8m
    // 10 completed years, not 9
    expect(screen.getByText("₹2,88,461.53")).toBeInTheDocument();
  });

  it("keeps exactly 9 years 6 months at 9 years (GAP-PAYROLL-STATUTORY-GRATUITY-03)", () => {
    renderCalculator();
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "9.5" } });
    expect(screen.getByText("₹2,59,615.38")).toBeInTheDocument();
  });
});

// GAP-PAYROLL-STATUTORY-GRATUITY-01: per-edition rule set.
describe("GratuityCalculator with a CCS DCRG rule", () => {
  function renderDcrg() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GratuityCalculator rule={{ ruleSet: "ccs_dcrg", minServiceYears: 5, ceilingMinor: "250000000", source: "tenant" }} />
      </NextIntlClientProvider>,
    );
  }

  it("22 years on Rs 1,50,000 emoluments is 1/4 x 44 half-years = Rs 16,50,000, not 15/26 x 22", () => {
    renderDcrg();
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "150000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "22" } });
    expect(screen.getByText("₹16,50,000.00")).toBeInTheDocument();
    expect(screen.queryByText("₹19,03,846.15")).not.toBeInTheDocument();
    expect(screen.getByText(/Government DCRG under the CCS \(Pension\) Rules/)).toBeInTheDocument();
  });

  it("caps at the configured DCRG ceiling and says so", () => {
    renderDcrg();
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "750000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "33" } });
    expect(screen.getByText("₹25,00,000.00")).toBeInTheDocument();
    expect(screen.getByText(/Capped at the DCRG ceiling of ₹25,00,000.00/)).toBeInTheDocument();
  });

  it("uses the rule's minimum service in the eligibility message", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <GratuityCalculator rule={{ ruleSet: "pog_act", minServiceYears: 1, ceilingMinor: "200000000", source: "tenant" }} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/Last Drawn Monthly Salary/), { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/Years of Service/), { target: { value: "2" } });
    expect(screen.queryByText(/requires a minimum/)).not.toBeInTheDocument();
    expect(screen.getByText("Estimated Gratuity")).toBeInTheDocument();
  });
});
