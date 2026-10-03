import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import { payrollRunStatusVariant } from "./statusLabels";

/** GAP-PAYROLL-HOME-07: completed (unpaid) must not look like paid. */
describe("payrollRunStatusVariant", () => {
  it("maps every run status to a distinct-enough tone, completed != paid", () => {
    expect(payrollRunStatusVariant("draft")).toBe("mut");
    expect(payrollRunStatusVariant("processing")).toBe("warn");
    expect(payrollRunStatusVariant("completed")).toBe("info");
    expect(payrollRunStatusVariant("paid")).toBe("good");
    expect(payrollRunStatusVariant("disbursed")).toBe("good");
    expect(payrollRunStatusVariant("failed")).toBe("bad");
    expect(payrollRunStatusVariant("completed")).not.toBe(payrollRunStatusVariant("paid"));
  });

  it("returns undefined for an unknown status so StatusPill's own default applies", () => {
    expect(payrollRunStatusVariant("mystery")).toBeUndefined();
  });

  it("renders different pill classes for completed and paid, with different text", () => {
    const { container: a } = render(<StatusPill status="completed" label="Completed" variant={payrollRunStatusVariant("completed")} />);
    const { container: b } = render(<StatusPill status="paid" label="Paid" variant={payrollRunStatusVariant("paid")} />);
    expect(a.querySelector(".pill")?.className).toBe("pill info");
    expect(b.querySelector(".pill")?.className).toBe("pill good");
    expect(a.textContent).not.toBe(b.textContent);
  });
});
