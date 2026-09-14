import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { formatMoney, formatRupees } from "@/lib/formatters";
import { expectRupeeGroundTruthDisplayed, expectMinorGroundTruthDisplayed } from "./money";

/**
 * Proves the COMP-019 shared test helper actually catches the two real,
 * historical rupee/paise mistakes it exists for — not just a contrived
 * example. Each `it("catches...")` renders a MINIMAL component shaped
 * exactly like the real historical bug (same formatter misuse, same class
 * of ground-truth amount) and asserts the helper throws against it; the
 * paired `it("passes...")` renders the fixed shape and asserts it doesn't.
 */

describe("expectRupeeGroundTruthDisplayed", () => {
  // Rs 90,000 is formatRupees()'s own docstring example, and the exact
  // amount named in the real payroll incident (#312): "a real net pay of
  // Rs 90,000 ... showed as Rs 900". Ground truth in paise: 9000000n.
  const NET_PAY_MINOR = 9000000n; // Rs 90,000.00 exactly

  it("passes against the fixed payroll shape (formatRupees on the converted rupee amount)", () => {
    function FixedPayslipStat({ netAmount }: { netAmount: number }) {
      return <div>{formatRupees(netAmount)}</div>;
    }
    render(<FixedPayslipStat netAmount={90000} />);
    expect(() => expectRupeeGroundTruthDisplayed(screen, NET_PAY_MINOR)).not.toThrow();
  });

  it("catches the real historical payroll mistake (#312: formatMoney on an already-rupee net pay)", () => {
    function BuggyPayslipStat({ netAmount }: { netAmount: number }) {
      return <div>{formatMoney(netAmount)}</div>; // pre-#312: reads 90000 as paise -> "Rs 900.00"
    }
    render(<BuggyPayslipStat netAmount={90000} />);
    expect(() => expectRupeeGroundTruthDisplayed(screen, NET_PAY_MINOR)).toThrow();
    // Confirms it's failing for the right reason -- the exact 100x-too-small
    // historical output is what's on screen instead of the correct one.
    expect(screen.getByText("₹900.00")).toBeInTheDocument();
    expect(screen.queryByText("₹90,000.00")).not.toBeInTheDocument();
  });

  it("passes against the fixed COMP-017 shape (formatRupees on project-service's already-converted scheme total)", () => {
    // Reuses COMP-016 "Test Scheme A"'s own minor-unit amount (see
    // SchemesTable.test.tsx) so this lines up with the real regression fixture.
    const TOTAL_OUTLAY_MINOR = "100000000"; // Rs 10,00,000 exactly
    function FixedSchemeRow({ totalAllocation }: { totalAllocation: number }) {
      return <span>{formatRupees(totalAllocation)}</span>;
    }
    render(<FixedSchemeRow totalAllocation={Number(TOTAL_OUTLAY_MINOR) / 100} />);
    expect(() => expectRupeeGroundTruthDisplayed(screen, TOTAL_OUTLAY_MINOR)).not.toThrow();
  });

  it("catches the real historical COMP-017 mistake (formatMoney on project-service's already-converted totalAllocation)", () => {
    const TOTAL_OUTLAY_MINOR = "100000000"; // Rs 10,00,000 exactly
    function BuggySchemeRow({ totalAllocation }: { totalAllocation: number }) {
      return <span>{formatMoney(totalAllocation)}</span>; // pre-#1253: reads the rupee number as paise
    }
    render(<BuggySchemeRow totalAllocation={Number(TOTAL_OUTLAY_MINOR) / 100} />);
    expect(() => expectRupeeGroundTruthDisplayed(screen, TOTAL_OUTLAY_MINOR)).toThrow();
  });

  it("does not false-fail when the correct and classic-mistake strings coincide (zero amount)", () => {
    function ZeroStat() {
      return <div>{formatRupees(0)}</div>;
    }
    render(<ZeroStat />);
    // formatRupees(0) === formatMoney(0) === "₹0.00" -- must not assert
    // both presence and absence of the identical string.
    expect(() => expectRupeeGroundTruthDisplayed(screen, 0)).not.toThrow();
  });

  it("fails loudly on a non-finite ground truth instead of silently misreporting", () => {
    render(<div>irrelevant</div>);
    expect(() => expectRupeeGroundTruthDisplayed(screen, Number.NaN)).toThrow(/not a finite amount/);
  });
});

describe("expectMinorGroundTruthDisplayed", () => {
  const AMOUNT_MINOR = 123456; // Rs 1,234.56

  it("passes against the correct shape (formatMoney on the raw minor amount)", () => {
    function CorrectStat({ amountMinor }: { amountMinor: number }) {
      return <div>{formatMoney(amountMinor)}</div>;
    }
    render(<CorrectStat amountMinor={AMOUNT_MINOR} />);
    expect(() => expectMinorGroundTruthDisplayed(screen, AMOUNT_MINOR)).not.toThrow();
  });

  it("catches the reverse mistake (formatRupees on a raw minor amount, over-displaying 100x)", () => {
    function BuggyStat({ amountMinor }: { amountMinor: number }) {
      return <div>{formatRupees(amountMinor)}</div>; // treats 123456 paise as if it were 123456 rupees
    }
    render(<BuggyStat amountMinor={AMOUNT_MINOR} />);
    expect(() => expectMinorGroundTruthDisplayed(screen, AMOUNT_MINOR)).toThrow();
    expect(screen.getByText("₹1,23,456.00")).toBeInTheDocument();
    expect(screen.queryByText("₹1,234.56")).not.toBeInTheDocument();
  });

  it("accepts a bigint ground truth", () => {
    function CorrectStat({ amountMinor }: { amountMinor: bigint }) {
      return <div>{formatMoney(amountMinor)}</div>;
    }
    render(<CorrectStat amountMinor={123456n} />);
    expect(() => expectMinorGroundTruthDisplayed(screen, 123456n)).not.toThrow();
  });
});
