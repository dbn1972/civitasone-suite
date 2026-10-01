import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { PayrollRunStepper } from "./PayrollRunStepper";

// GAP-PAYROLL-DETAIL-08: PayrollRunStepper previously mapped the wire
// status "completed" to the Review step (index 2) and "failed" to the
// Approve step (index 3) -- both unreachable/wrong once payroll-service's
// real contract is accounted for: the wire enum is only ever draft/
// processing/completed/paid/failed (queries.ts mapRunStatus remaps the
// internal approved/disbursed to completed/paid before the API responds),
// "completed" means approved-and-awaiting-disbursement (past Approve, not
// before it), and "failed" is only reachable from "processing"
// (domain.ts assertRunStatusTransition). It also showed a spinner on every
// "current" step including resting states (draft, completed) that are
// waiting on a human action, not an in-flight computation. This component
// had no test coverage at all before this fix.
function renderStepper(status: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PayrollRunStepper status={status} />
    </NextIntlClientProvider>,
  );
}

describe("PayrollRunStepper", () => {
  it('"draft" marks step 1 (Data Lock) current, waiting on a human -- shows the step number, not a spinner', () => {
    const { container } = renderStepper("draft");
    const current = container.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toBe("1");
  });

  it('"processing" marks step 2 (Calculate) current with an active spinner (the only real in-flight state)', () => {
    const { container } = renderStepper("processing");
    const current = container.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    // Spinner renders as an empty, aria-hidden span -- no step-number text.
    expect(current?.textContent).toBe("");
  });

  it('"completed" (approved, awaiting disbursement) marks step 5 (Disburse) current -- not stuck on Approve/Review -- with steps 1-4 done and no spinner', () => {
    const { container } = renderStepper("completed");
    const current = container.querySelector('[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current?.textContent).toBe("5"); // Disburse, not Review (index 2) or Approve (index 3)
    expect(container.textContent?.match(/✓/g)?.length).toBe(4); // Data Lock..Approve all done
  });

  it('"paid" marks every step done (checkmarks), with no step current', () => {
    const { container } = renderStepper("paid");
    expect(container.querySelector('[aria-current="step"]')).toBeNull();
    expect(container.textContent?.match(/✓/g)?.length).toBe(5);
  });

  it('"failed" marks step 2 (Calculate) as the error step -- it can only fail during processing, never at Approve', () => {
    const { container } = renderStepper("failed");
    // The error state is distinct from "current" (no aria-current="step"
    // here, matching this component's existing convention -- only an
    // active/waiting step gets aria-current, same as before this fix) --
    // locate it by its ✕ glyph instead.
    const circles = Array.from(container.querySelectorAll("ol > li > div > div"));
    const errorCircle = circles.find((el) => el.textContent === "✕");
    expect(errorCircle).not.toBeUndefined();
    // Step 1 (Data Lock) is done; steps 3-5 are untouched pending numbers.
    expect(container.textContent).toContain("✓");
    expect(container.textContent).toContain("3");
    expect(container.textContent).toContain("4");
    expect(container.textContent).toContain("5");
  });
});
