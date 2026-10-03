import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ComponentGrid } from "./ComponentGrid";

function renderGrid(components: React.ComponentProps<typeof ComponentGrid>["components"]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComponentGrid components={components} />
    </NextIntlClientProvider>,
  );
}

describe("ComponentGrid", () => {
  it("shows a hedged note that the taxable flag is not an exemption determination", () => {
    renderGrid([{ id: "c1", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: false }]);
    expect(screen.getByText(/not an exemption determination/i)).toHaveTextContent(/115BAC/);
  });

  // GAP-PAYROLL-STRUCTURES-03: taxability used to be derived from a
  // component-CODE substring match that overrode the API's own isTaxable
  // for any code containing HRA/LTA/MEDICAL/TA/TRANSPORT/NPS/GPF/PF/EPF/
  // GRATUITY/DA/DEARNESS/BASIC -- "TA" matched DEPUTATION_ALLOWANCE, and a
  // wrong tax-exempt label can mislead payroll admins into misconfiguring
  // TDS. Trust the API's isTaxable field only.
  it("derives Taxable/Not marked from the API's isTaxable field only, ignoring the component code", () => {
    renderGrid([
      { id: "c1", code: "DEPUTATION_ALLOWANCE", name: "Deputation Allowance", componentType: "allowance", isTaxable: true },
      { id: "c2", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: true },
    ]);
    const taxableBadges = screen.getAllByText("Taxable");
    expect(taxableBadges).toHaveLength(2);
    expect(screen.queryByText("Partially Exempt")).not.toBeInTheDocument();
  });

  // is_taxable defaults to false and no API writes it, so false means "not
  // marked", never "exempt" -- the dev seed stores Basic Pay as false, and
  // basic pay is fully taxable (s.15/17(1)). Must not render an exemption.
  it("shows 'Not marked taxable' (never 'Exempt') when isTaxable is false, e.g. BASIC", () => {
    renderGrid([{ id: "c3", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: false }]);
    expect(screen.getByText("Not marked taxable")).toBeInTheDocument();
    expect(screen.queryByText(/exempt/i, { selector: "span" })).not.toBeInTheDocument();
    expect(screen.queryByText("Taxable")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-STRUCTURES-01: the "Active" switch used to be local React
  // state only -- toggling it called setEnabled with no request anywhere in
  // the file, so it looked like a real control but persisted nothing and
  // reset on every reload. Removed until a real persistence endpoint exists.
  it("never renders an Active toggle switch", () => {
    renderGrid([{ id: "c1", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: true }]);
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByText("Active")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-STRUCTURES-03: the formula tooltip used to show a
  // hard-coded rate/slab (e.g. "currently 46%" for DA) looked up by a
  // component-code substring, presented with no source or date, and DA is a
  // rate FinMin revises quarterly. No API field backs a per-component
  // formula, so it always reads "not configured" now.
  it("with no configured rule says so, and never shows a hard-coded rate, even for a DA/HRA code", () => {
    renderGrid([
      { id: "c1", code: "DA", name: "Dearness Allowance", componentType: "earning", isTaxable: true },
      { id: "c2", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: true },
    ]);
    const formulaButtons = screen.getAllByRole("button", { name: /calculation formula/i });
    fireEvent.focus(formulaButtons[0]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("No calculation rule is configured for this component");
    expect(screen.queryByText(/currently 46%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/27%, Y=18%, Z=9%/)).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-STRUCTURES-03: the tooltip shows only what the API returns for THIS component.
  it("shows the configured rule from the API (pct of basic / fixed / formula) and labels it as configured, not statutory", () => {
    renderGrid([
      { id: "c1", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: true, pctOfBasic: "24.00", fixedMinor: null, formula: null },
      { id: "c2", code: "CONV", name: "Conveyance", componentType: "allowance", isTaxable: false, pctOfBasic: null, fixedMinor: "160000", formula: "MIN(basic*0.1, 2500)" },
    ]);
    const buttons = screen.getAllByRole("button", { name: /calculation formula/i });
    fireEvent.focus(buttons[0]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Calculated as 24% of basic");
    expect(screen.getByRole("tooltip")).toHaveTextContent("not a statutory rate");
    fireEvent.blur(buttons[0]);
    fireEvent.focus(buttons[1]);
    expect(screen.getByRole("tooltip")).toHaveTextContent("Fixed amount ₹1,600.00");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Formula: MIN(basic*0.1, 2500)");
  });
});
