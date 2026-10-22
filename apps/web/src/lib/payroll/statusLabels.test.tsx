import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "@/app/_components/ds/StatusPill";
import {
  bucketIncomeTaxStatuses,
  bucketPayrollRuns,
  incomeTaxStatusLabel,
  isPaidPayrollRunStatus,
  latestPayrollRun,
  payrollRunStatusVariant,
} from "./statusLabels";

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

/** GAP-PAYROLL-PERIOD-02: the Home and Period tiles bucket runs through these. */
describe("bucketPayrollRuns", () => {
  it("splits [paid, approved, failed, draft] into buckets that sum to the run count", () => {
    // "approved" is not a wire status (payroll-service maps it to "completed"),
    // which is exactly why it is the probe: an unrecognised value must still
    // land in a bucket instead of falling out of every tile.
    const b = bucketPayrollRuns([{ status: "paid" }, { status: "approved" }, { status: "failed" }, { status: "draft" }]);
    expect(b).toEqual({ total: 4, paid: 1, failed: 1, inProgress: 2 });
    expect(b.paid + b.failed + b.inProgress).toBe(b.total);
  });

  it("counts completed (approved, awaiting disbursement) as in progress, never as paid", () => {
    expect(bucketPayrollRuns([{ status: "completed" }, { status: "processing" }])).toEqual({
      total: 2, paid: 0, failed: 0, inProgress: 2,
    });
  });

  it("treats disbursed like paid (money has moved) and an empty list as all zeros", () => {
    expect(isPaidPayrollRunStatus("paid")).toBe(true);
    expect(isPaidPayrollRunStatus("disbursed")).toBe(true);
    expect(isPaidPayrollRunStatus("completed")).toBe(false);
    expect(bucketPayrollRuns([{ status: "disbursed" }]).paid).toBe(1);
    expect(bucketPayrollRuns([])).toEqual({ total: 0, paid: 0, failed: 0, inProgress: 0 });
  });
});

describe("latestPayrollRun", () => {
  const run = (id: string, payPeriod: string, runDate = "2026-01-01") => ({ id, payPeriod, runDate, employeeCount: 0 });

  it("picks the highest pay period regardless of list order", () => {
    const runs = [run("a", "2026-07"), run("b", "2026-09"), run("c", "2026-08")];
    expect(latestPayrollRun(runs)?.id).toBe("b");
    expect(latestPayrollRun([...runs].reverse())?.id).toBe("b");
  });

  it("breaks a same-period tie by run date, then id, deterministically", () => {
    expect(latestPayrollRun([run("a", "2026-08", "2026-08-31"), run("b", "2026-08", "2026-09-02")])?.id).toBe("b");
    expect(latestPayrollRun([run("a", "2026-08"), run("b", "2026-08")])?.id).toBe("b");
    expect(latestPayrollRun([run("b", "2026-08"), run("a", "2026-08")])?.id).toBe("b");
  });

  it("returns null for no runs", () => {
    expect(latestPayrollRun([])).toBeNull();
  });
});

/** GAP-PAYROLL-INCOME-TAX-04 */
describe("bucketIncomeTaxStatuses", () => {
  it("keeps Finalized/Pending as before and puts every other status in Other, so the tiles sum to Total", () => {
    const b = bucketIncomeTaxStatuses([
      { status: "submitted" }, { status: "finalized" }, { status: "completed" },
      { status: "pending" }, { status: "draft" },
      { status: "verified" }, { status: "approved" }, { status: "something-new" },
    ]);
    expect(b).toEqual({ total: 8, finalized: 3, pending: 2, other: 3 });
    expect(b.finalized + b.pending + b.other).toBe(b.total);
  });

  it("has an empty Other bucket when every status is a known one", () => {
    expect(bucketIncomeTaxStatuses([{ status: "submitted" }, { status: "pending" }]).other).toBe(0);
  });
});

describe("incomeTaxStatusLabel", () => {
  // Minimal translator stub: echoes the key, so the assertion is on WHICH key is requested.
  const t = ((key: string) => `T(${key})`) as never;

  it("translates the DB-valid verified/approved statuses (they used to render as raw English)", () => {
    expect(incomeTaxStatusLabel("verified", t)).toBe("T(status.verified)");
    expect(incomeTaxStatusLabel("approved", t)).toBe("T(status.approved)");
  });

  it("falls back to the raw value for a status it does not know", () => {
    expect(incomeTaxStatusLabel("something-new", t)).toBe("something-new");
  });
});
