import { expect } from "vitest";
import { formatMoney, formatRupees, minorToRupeesOrNull } from "@/lib/formatters";

/**
 * Shared test helper for the rupee/paise unit-convention bug — COMP-019.
 *
 * This codebase has hit the same bug twice: a list endpoint and its own
 * sibling detail endpoint silently land on different money-unit conventions
 * for "the same" field (one whole-rupees, one minor-unit paise), and a
 * formatMoney()/formatRupees() call site that matches the WRONG one just
 * silently under- or over-displays by exactly 100x — nothing in the type
 * system catches it, because both formatters accept `number | string` and
 * neither knows what unit its caller actually holds.
 *
 *   - payroll (fixed in #312): payroll-runs API returns grossAmount/
 *     netAmount/deductions in RUPEES; PayrollRunsTable.tsx, PayrollRunActions.tsx,
 *     hr/payroll/[id]/page.tsx and hr/payroll/page.tsx all rendered them via
 *     formatMoney()/cellType:"amount" (which divides by 100) — a real net pay
 *     of Rs 90,000 showed as Rs 900 on the screen used to confirm a bank
 *     transfer. formatRupees() was added specifically for this.
 *   - project-service schemes (COMP-016/COMP-017, #1240/#1253): listSchemeSummaries()
 *     sends totalAllocation/releasedAmount already converted to whole rupees;
 *     SchemesTable.tsx fed them straight into formatMoney() anyway, under-
 *     displaying every Allocation/Released figure 100x.
 *
 * Both times, the mismatch crossed a service/API boundary that is invisible
 * to any check confined to the frontend call site itself — the arguments at
 * the point of the bug were plainly-named numbers (`totalAllocation`,
 * `grossAmount`) with no local syntactic tell (no adjacent `/100`, no
 * `Minor`/`Paise` in the name) that they were already-converted rupees. A
 * static grep/lint heuristic over call-site text was evaluated for COMP-019
 * and rejected for exactly this reason — see docs/ENTERPRISE-GAP-REPORT-
 * 2026-09-07.md's COMP-019 row for the full writeup, including a concrete
 * example (hr/payroll/slips/[id]/page.tsx vs. SalarySlipsClientTable.tsx)
 * where two call sites share the identical field names (gross/net/deductions)
 * and are BOTH correct today despite using different formatters, because
 * they read from two backend queries that disagree on unit convention by
 * design — a naming-based guard cannot tell these apart without producing
 * false positives.
 *
 * What DOES generalize from both fixes' own regression tests (see
 * SchemesTable.test.tsx / page.test.tsx, COMP-017) is a specific pattern:
 * anchor on one known ground-truth MINOR (paise) amount, compute what the
 * component SHOULD display for it, compute the exact wrong string the
 * classic mistake would have produced, and assert the first is present and
 * the second is absent. That pattern doesn't need to know which formatter
 * is "supposed" to be correct in general — it only needs a real fixture
 * value and the field's documented unit contract, both of which the test
 * author already has. These two functions extract that pattern so a new
 * list/detail pair doesn't have to hand-roll the minor/rupee arithmetic and
 * the double assertion (a place where a copy-paste of the WRONG expected
 * string, matching the very bug being tested for, would otherwise silently
 * defeat the test).
 *
 * Usage (component test, `render()` already called):
 *
 *   import { expectRupeeGroundTruthDisplayed } from "@/lib/testUtils/money";
 *
 *   const OUTLAY_MINOR = 100000000n; // ground truth: Rs 10,00,000 exactly
 *   render(<SchemesTable rows={[{ ...row, totalAllocation: Number(OUTLAY_MINOR) / 100 }]} />);
 *   expectRupeeGroundTruthDisplayed(screen, OUTLAY_MINOR);
 *
 * Works equally with a `within(row)` query object for a single table row,
 * since both `screen` and `within(...)` expose the same getByText/queryByText
 * shape.
 */

type TextQueries = {
  getByText: (text: string) => HTMLElement;
  queryByText: (text: string) => HTMLElement | null;
};

/** bigint isn't a valid formatRupees() argument type — stringify it, same as
 *  every real API response would (JSON has no bigint) rather than risk
 *  losing precision through Number(). */
function toRupeesArg(minor: bigint | number | string): number | string {
  return typeof minor === "bigint" ? minor.toString() : minor;
}

/**
 * Assert that a component displays `groundTruthMinor` (a known real amount,
 * expressed in minor units/paise — the one true source of truth) correctly
 * AS WHOLE RUPEES, i.e. via formatRupees() applied to the converted amount —
 * and that it does NOT ALSO show the specific wrong text the historical
 * payroll/COMP-017 mistake produces: formatMoney() applied to that same
 * already-converted rupee number, which reads it as paise and under-displays
 * by exactly 100x.
 *
 * Use this for any field whose API contract is "already converted to whole
 * rupees before it reaches the frontend" (payroll-runs grossAmount/netAmount/
 * deductions; project-service's scheme-summary totalAllocation/releasedAmount)
 * — the fields formatRupees()'s own docstring exists to warn about.
 */
export function expectRupeeGroundTruthDisplayed(queries: TextQueries, groundTruthMinor: bigint | number | string): void {
  const rupees = minorToRupeesOrNull(groundTruthMinor);
  if (rupees === null) {
    throw new Error(`expectRupeeGroundTruthDisplayed: groundTruthMinor (${String(groundTruthMinor)}) is not a finite amount`);
  }
  const correct = formatRupees(rupees);
  const theClassicMistake = formatMoney(rupees); // formatMoney() on an already-converted rupee number
  expect(queries.getByText(correct)).toBeInTheDocument();
  // Only assert absence when the two strings actually differ (e.g. a zero
  // amount formats identically either way) — otherwise this would assert a
  // node both is and isn't present.
  if (theClassicMistake !== correct) {
    expect(queries.queryByText(theClassicMistake)).not.toBeInTheDocument();
  }
}

/**
 * The mirror image of expectRupeeGroundTruthDisplayed(), for completeness:
 * assert a component displays `groundTruthMinor` correctly AS MINOR UNITS
 * (paise) — i.e. via formatMoney() applied directly — and that it does NOT
 * ALSO show the reverse mistake: formatRupees() applied to the raw minor
 * integer, which reads paise as if they were whole rupees and OVER-displays
 * by exactly 100x. No historical occurrence of this exact direction is on
 * record in this codebase (both COMP-016/017 and the payroll bug were the
 * other direction — a rupee value that reached formatMoney()), but the
 * mistake is the same class and this codebase's own guard convention
 * (see e.g. money-precision-guard.mjs) covers both directions of its own
 * analogous bug, so this does too.
 *
 * Use this for any field whose API contract is minor units/paise — the
 * common case, and formatMoney()'s own default assumption.
 */
export function expectMinorGroundTruthDisplayed(queries: TextQueries, groundTruthMinor: bigint | number | string): void {
  const correct = formatMoney(groundTruthMinor);
  const theReverseMistake = formatRupees(toRupeesArg(groundTruthMinor)); // formatRupees() on the raw minor integer
  expect(queries.getByText(correct)).toBeInTheDocument();
  if (theReverseMistake !== correct) {
    expect(queries.queryByText(theReverseMistake)).not.toBeInTheDocument();
  }
}
