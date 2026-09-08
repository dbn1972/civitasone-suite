import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SalaryStructureCard } from "./SalaryStructureCard";

const COMPONENTS = [
  { id: "c1", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: true },
  { id: "c2", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: false },
  { id: "c3", code: "PF", name: "Provident Fund", componentType: "deduction", isTaxable: false },
];

describe("SalaryStructureCard", () => {
  it("renders the real per-structure breakdown when components exist", () => {
    render(
      <SalaryStructureCard id="s1" name="Group B Structure" isDefault={false} status="active" components={COMPONENTS} />,
    );
    expect(screen.getByText("3 components", { exact: false })).toBeInTheDocument();
  });

  // COMP-004 fix-up (round 3): buildChartData() used to return the
  // hardcoded GOI_STANDARD_PCT reference breakdown whenever a structure's
  // real component list was empty, and the card labelled it "GoI standard
  // distribution shown" as if it described this specific structure. This
  // proves that fabricated substitution is gone: an empty component list
  // renders an honest "not configured" state, never the fake percentages.
  it("shows an honest 'no components configured' state instead of fabricated GoI percentages", () => {
    render(
      <SalaryStructureCard id="s2" name="New Structure" isDefault={false} status="draft" components={[]} />,
    );
    expect(screen.getByText("No components configured yet", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("No components configured")).toBeInTheDocument();
    // None of the fabricated GOI_STANDARD_PCT labels ever render.
    expect(screen.queryByText("Basic", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/DA \(46%\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TA\+Transport/)).not.toBeInTheDocument();
    expect(screen.queryByText("GoI standard distribution shown")).not.toBeInTheDocument();
  });
});
