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
});

