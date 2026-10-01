import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SalaryStructureCard } from "./SalaryStructureCard";

const COMPONENTS = [
  { id: "c1", code: "BASIC", name: "Basic Pay", componentType: "earning", isTaxable: true },
  { id: "c2", code: "HRA", name: "House Rent Allowance", componentType: "allowance", isTaxable: false },
  { id: "c3", code: "PF", name: "Provident Fund", componentType: "deduction", isTaxable: false },
];

// UX-017: SalaryStructureCard now reads its copy through next-intl
// (useTranslations("salaryStructureCard")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderCard(props: React.ComponentProps<typeof SalaryStructureCard>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SalaryStructureCard {...props} />
    </NextIntlClientProvider>,
  );
}

describe("SalaryStructureCard", () => {
  it("renders the real per-structure breakdown when components exist", () => {
    renderCard({ id: "s1", name: "Group B Structure", isDefault: false, status: "active", components: COMPONENTS });
    expect(screen.getByText("3 components", { exact: false })).toBeInTheDocument();
  });

  // COMP-004 fix-up (round 3): buildChartData() used to return the
  // hardcoded GOI_STANDARD_PCT reference breakdown whenever a structure's
  // real component list was empty, and the card labelled it "GoI standard
  // distribution shown" as if it described this specific structure. This
  // proves that fabricated substitution is gone: an empty component list
  // renders an honest "not configured" state, never the fake percentages.
  it("shows an honest 'no components configured' state instead of fabricated GoI percentages", () => {
    renderCard({ id: "s2", name: "New Structure", isDefault: false, status: "draft", components: [] });
    expect(screen.getByText("No components configured yet", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("No components configured")).toBeInTheDocument();
    // None of the fabricated GOI_STANDARD_PCT labels ever render.
    expect(screen.queryByText("Basic", { exact: false })).not.toBeInTheDocument();
    expect(screen.queryByText(/DA \(46%\)/)).not.toBeInTheDocument();
    expect(screen.queryByText(/TA\+Transport/)).not.toBeInTheDocument();
    expect(screen.queryByText("GoI standard distribution shown")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-STRUCTURES-02: "Applicable Pay Levels" used to be guessed
  // from the structure NAME by substring match (inferPayBands) and
  // presented as if it were real data from the API -- "level 1" matched
  // "level 10/11/12" too, so e.g. "Director - Level 10" was mislabelled
  // MTS/Helper. The API (Row: id/name/isDefault/status) has never carried a
  // pay-levels field at all; the block is gone rather than guessed better.
  it("never shows a guessed 'Applicable Pay Levels' block", () => {
    renderCard({ id: "s3", name: "Director - Level 10", isDefault: false, status: "active", components: COMPONENTS });
    expect(screen.queryByText("Applicable Pay Levels")).not.toBeInTheDocument();
    expect(screen.queryByText("MTS")).not.toBeInTheDocument();
    expect(screen.queryByText("Helper")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-STRUCTURES-04: the donut's heading used to say "% of Gross"
  // over values that are component COUNTS by type, not a share of gross pay.
  it("labels the donut 'Components by type', not the old mislabeled '% of Gross'", () => {
    renderCard({ id: "s4", name: "Any Structure", isDefault: false, status: "active", components: COMPONENTS });
    expect(screen.getByText("Components by type")).toBeInTheDocument();
    expect(screen.queryByText("% of Gross")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-STRUCTURES-05: components={[]} used to be indistinguishable
  // from "genuinely not configured yet" -- an outage on the components
  // fetch looked identical to an empty, healthy structure.
  it("shows 'Components unavailable' (not 'not configured yet') when the components fetch failed", () => {
    renderCard({ id: "s5", name: "Any Structure", isDefault: false, status: "active", components: [], componentsUnavailable: true });
    // Rendered twice: the summary line and the donut-chart placeholder.
    expect(screen.getAllByText("Components unavailable", { exact: false }).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("No components configured yet")).not.toBeInTheDocument();
  });
});
