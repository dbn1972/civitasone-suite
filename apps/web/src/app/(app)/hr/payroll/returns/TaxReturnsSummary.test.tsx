import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createTranslator } from "next-intl";
import enMessages from "@/messages/en.json";
import { TaxReturnsSummary, type QuarterSummaryRow } from "./TaxReturnsSummary";

// UX-017: TaxReturnsSummary is a plain (non-async) component that now takes
// its translator as a `t` prop (its caller, ReturnsPage, resolves it via
// getTranslations("taxReturnsSummary") -- see TaxReturnsSummary.tsx's own
// comment for why it isn't async itself). For this standalone unit test
// there is no page/provider in the tree, so build a real translator
// directly from the same en.json this ships with -- no React context needed.
const t = createTranslator({ locale: "en", messages: enMessages, namespace: "taxReturnsSummary" });

function baseRow(overrides: Partial<QuarterSummaryRow>): QuarterSummaryRow {
  return {
    quarter: "Q1",
    status: "filed",
    filingDate: "2026-07-15",
    challanRef: "CHLN-1",
    totalTdsDepositedMinor: 0,
    deducteeCount: 0,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// UX-018: totalTdsDepositedMinor is guarded by `deducteeCount > 0` before the
// row is shown at all, but that doesn't guarantee totalTdsDepositedMinor
// itself is present — a partial API response could carry deductees without a
// computed total. A missing total must render "—", never a fabricated
// "₹0.00" that looks identical to a genuinely-zero deposit.
// ---------------------------------------------------------------------------
describe("TaxReturnsSummary — missing totalTdsDepositedMinor (UX-018)", () => {
  it("renders an em-dash when totalTdsDepositedMinor is missing despite deducteeCount > 0", () => {
    const quarters = [
      baseRow({
        quarter: "Q1",
        deducteeCount: 5,
        totalTdsDepositedMinor: undefined as unknown as number,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} t={t} />);

    // Scoped to the Q1 row: with only one quarter in the array, the annual
    // "Total TDS Deposited" tile now *also* shows "—" for this same missing
    // value (UX-022), so an unscoped, page-wide getByText("—") would match
    // both and be ambiguous.
    const q1Row = screen.getByText("Q1 — Apr to Jun").closest("div[style*='border']") as HTMLElement;
    expect(within(q1Row).getByText("TDS Deposited")).toBeInTheDocument();
    expect(within(q1Row).getByText("—")).toBeInTheDocument();
    expect(within(q1Row).queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("renders an em-dash for a null totalTdsDepositedMinor too", () => {
    const quarters = [
      baseRow({
        quarter: "Q2",
        deducteeCount: 3,
        totalTdsDepositedMinor: null as unknown as number,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} t={t} />);

    // Scoped for the same reason as the case above (see UX-022).
    const q2Row = screen.getByText("Q2 — Jul to Sep").closest("div[style*='border']") as HTMLElement;
    expect(within(q2Row).getByText("—")).toBeInTheDocument();
  });

  it("still renders a genuine zero deposit as ₹0.00, distinct from missing data", () => {
    const quarters = [
      baseRow({
        quarter: "Q3",
        deducteeCount: 2,
        totalTdsDepositedMinor: 0,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} t={t} />);

    // Scoped to the Q3 row itself: the annual "Total TDS Deposited" summary
    // tile independently sums every quarter and would coincidentally also
    // show "₹0.00" here (a related but separate masking risk — see the
    // UX-022 row filed alongside this fix), so a page-wide getByText("₹0.00")
    // would be ambiguous.
    const q3Row = screen.getByText("Q3 — Oct to Dec").closest("div[style*='border']");
    expect(q3Row).not.toBeNull();
    expect(within(q3Row as HTMLElement).getByText("₹0.00")).toBeInTheDocument();
  });

  it("does not render the TDS Deposited figure at all when deducteeCount is 0 (unrelated existing gate)", () => {
    const quarters = [baseRow({ quarter: "Q4", deducteeCount: 0 })];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} t={t} />);

    expect(screen.queryByText("TDS Deposited")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// UX-022: the annual "Total TDS Deposited" tile reduces totalTdsDepositedMinor
// across the whole `quarters` array. A bare `+` reduce has the same
// missing-vs-masked-zero exposure UX-018 fixes per-quarter, but one level up:
// one quarter with totalTdsDepositedMinor === undefined propagates NaN through
// the entire reduce ("₹NaN" for the year); one with null silently coerces
// (`s + null === s`), undercounting the true total with no visible sign
// anything is wrong. Convention, chosen to match UX-018's per-quarter answer
// to the same question (show "—" rather than a fabricated number): if ANY
// quarter's total is unknown, the annual tile shows "—" too, rather than
// quietly summing only the known quarters — silently excluding a missing
// quarter from a sum is indistinguishable from treating it as a real zero,
// which is the exact masking this campaign closes.
// ---------------------------------------------------------------------------
describe("TaxReturnsSummary — annual Total TDS Deposited tile (UX-022)", () => {
  function totalTile(): HTMLElement {
    return screen.getByText("Total TDS Deposited").parentElement as HTMLElement;
  }

  it("sums every quarter correctly when all totals are present", () => {
    const quarters = [
      baseRow({ quarter: "Q1", deducteeCount: 5, totalTdsDepositedMinor: 100000 }),
      baseRow({ quarter: "Q2", deducteeCount: 3, totalTdsDepositedMinor: 250000 }),
      baseRow({ quarter: "Q3", deducteeCount: 2, totalTdsDepositedMinor: 50000 }),
      baseRow({ quarter: "Q4", deducteeCount: 0, totalTdsDepositedMinor: 0 }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} t={t} />);

    expect(within(totalTile()).getByText("₹4,000.00")).toBeInTheDocument();
  });

  it("renders an em-dash instead of ₹NaN when one quarter's total is undefined", () => {
    const quarters = [
      baseRow({ quarter: "Q1", deducteeCount: 5, totalTdsDepositedMinor: 100000 }),
      baseRow({
        quarter: "Q2",
        deducteeCount: 5,
        totalTdsDepositedMinor: undefined as unknown as number,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} t={t} />);

    expect(within(totalTile()).getByText("—")).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });

  it("renders an em-dash instead of silently undercounting when one quarter's total is null", () => {
    const quarters = [
      baseRow({ quarter: "Q1", deducteeCount: 5, totalTdsDepositedMinor: 100000 }),
      baseRow({
        quarter: "Q2",
        deducteeCount: 5,
        totalTdsDepositedMinor: null as unknown as number,
      }),
    ];
    render(<TaxReturnsSummary fy="2026-27" quarters={quarters} t={t} />);

    const tile = totalTile();
    expect(within(tile).getByText("—")).toBeInTheDocument();
    // The silent-undercount failure mode would render Q1's ₹1,000.00 alone,
    // quietly ignoring the unknown Q2 total — must not appear in the tile.
    expect(within(tile).queryByText("₹1,000.00")).not.toBeInTheDocument();
  });
});
