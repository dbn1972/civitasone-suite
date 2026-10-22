import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// The REAL useSeededResource runs here (that is the point: its state is seeded
// from the `runs` prop exactly once). Only its IndexedDB-backed offline cache
// is stubbed, since jsdom has no IndexedDB.
const { readCacheMock, writeCacheMock } = vi.hoisted(() => ({
  readCacheMock: vi.fn(async () => null),
  writeCacheMock: vi.fn(async () => undefined),
}));
vi.mock("@/lib/sync/responseCache", () => ({ readCache: readCacheMock, writeCache: writeCacheMock }));

import { PayrollRunsTable } from "./PayrollRunsTable";

type Props = React.ComponentProps<typeof PayrollRunsTable>;

const run = (id: string, payPeriod: string, status = "draft") => ({
  id, runDate: "2026-09-01", payPeriod, employeeCount: 10, grossAmount: 100000, netAmount: 90000, deductions: 10000, status,
}) as Props["runs"][number];

function tree(props: Props) {
  return (
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PayrollRunsTable {...props} />
    </NextIntlClientProvider>
  );
}

/**
 * GAP-PAYROLL-HOME-06: CreatePayrollRunForm calls router.refresh() on the
 * pay-group "created N runs" branch and the no-id fallback -- both stay on
 * /hr/payroll. The server component re-renders with the new run list and hands
 * it down as a new `runs` prop; the table used to keep the rows it first
 * rendered, so the run just created did not appear until a full reload.
 */
describe("PayrollRunsTable -- list freshness after a server refresh (GAP-PAYROLL-HOME-06)", () => {
  beforeEach(() => {
    readCacheMock.mockClear();
    writeCacheMock.mockClear();
  });

  it("shows a newly created run when the server re-renders with an extended runs prop", async () => {
    const { rerender } = render(tree({ runs: [run("run-a", "2026-07")] }));
    expect(screen.getByText("2026-07")).toBeInTheDocument();
    expect(screen.queryByText("2026-08")).not.toBeInTheDocument();

    // router.refresh() -> same page, fresh server data with the new run.
    rerender(tree({ runs: [run("run-a", "2026-07"), run("run-b", "2026-08")] }));

    await waitFor(() => expect(screen.getByText("2026-08")).toBeInTheDocument());
    expect(screen.getByText("2026-07")).toBeInTheDocument();
  });

  it("shows a changed status for an existing run after a refresh (e.g. draft -> paid)", async () => {
    const { rerender } = render(tree({ runs: [run("run-a", "2026-07", "draft")] }));
    expect(screen.getByText("Draft")).toBeInTheDocument();

    rerender(tree({ runs: [run("run-a", "2026-07", "paid")] }));

    await waitFor(() => expect(screen.getByText("Paid")).toBeInTheDocument());
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });

  it("does not remount (or re-write the offline copy) when the same data is passed again", async () => {
    const { rerender } = render(tree({ runs: [run("run-a", "2026-07")] }));
    await waitFor(() => expect(writeCacheMock).toHaveBeenCalledTimes(1));

    // A new array with identical contents: an ordinary parent re-render.
    rerender(tree({ runs: [run("run-a", "2026-07")] }));

    expect(screen.getByText("2026-07")).toBeInTheDocument();
    expect(writeCacheMock).toHaveBeenCalledTimes(1);
  });
});
