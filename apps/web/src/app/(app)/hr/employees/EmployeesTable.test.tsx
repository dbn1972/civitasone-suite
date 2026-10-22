import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";

const readCacheMock = vi.fn();
const writeCacheMock = vi.fn();
vi.mock("@/lib/sync/responseCache", () => ({
  readCache: (...args: unknown[]) => readCacheMock(...args),
  writeCache: (...args: unknown[]) => writeCacheMock(...args),
}));
vi.mock("@/lib/sync/headers", () => ({ buildSyncHeaders: () => ({}) }));

const ROWS: EmpRow[] = [
  { id: "e1", employeeNo: "E1", name: "Priya Sharma", department: "Finance", status: "confirmed", employeeType: "permanent" },
];

function renderTable(employees: EmpRow[], source: "api" | "error" = "api", canCreate = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EmployeesTable employees={employees} source={source} canCreate={canCreate} />
    </NextIntlClientProvider>,
  );
}

describe("EmployeesTable", () => {
  beforeEach(() => {
    readCacheMock.mockReset().mockResolvedValue(null);
    writeCacheMock.mockReset();
  });

  it("renders the roster with a Joining Date column", () => {
    renderTable([{ id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance", status: "confirmed", dateOfJoining: "2020-04-01" }]);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Joining Date" })).toBeInTheDocument();
  });

  // GAP-HR-EMPLOYEES-06 (partial): the backend doesn't return dateOfJoining
  // on origin/main yet (lands via a separate, already-open PR) -- this
  // column must degrade to a dash, not blow up or show "undefined".
  it("shows a dash for Joining Date when the backend hasn't supplied it yet", () => {
    renderTable([{ id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance", status: "confirmed" }]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  /** GAP-HR-EMPLOYEES-05: employeeType was returned by the API but never rendered. */
  it("renders an Employee Type column", async () => {
    renderTable(ROWS, "api");
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("permanent")).toBeInTheDocument());
  });

  it("shows the honest empty state for a genuinely empty roster", () => {
    renderTable([]);
    expect(screen.getByText("Your team starts here")).toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-02: failure (nothing cached) must not look like an
   * honest empty roster -- no "add your first employee" invitation.
   */
  it("shows a distinct, non-inviting empty state on a real load failure with nothing cached", async () => {
    renderTable([], "error");
    await waitFor(() => expect(screen.getByText("Couldn't load your team")).toBeInTheDocument());
    expect(screen.queryByText("Your team starts here")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add first employee" })).not.toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-02 (acceptance): the failure state is a real
   * RefreshErrorState -- an alert with a working Retry -- not a static
   * paragraph telling the user to refresh by hand.
   */
  it("renders an alert with a Retry control (and a way back) on a real load failure", async () => {
    renderTable([], "error");
    const alert = await screen.findByRole("alert");
    expect(within(alert).getByText("Couldn't load your team")).toBeInTheDocument();
    expect(within(alert).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(within(alert).getByRole("link", { name: "Go back" })).toHaveAttribute("href", "/hr");
    // The failure replaces the grid: no table is rendered at all.
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("does not render an alert for a healthy roster", async () => {
    renderTable(ROWS, "api");
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-04: the CSV is built from the rows of ONE server page,
   * so the button must say so rather than imply a full-roster export.
   */
  it("labels the CSV export as covering only the rows on this page", async () => {
    renderTable([...ROWS, { id: "e2", employeeNo: "E2", name: "Asha Rao", department: "HR", status: "confirmed", employeeType: "permanent" }]);
    await waitFor(() => expect(screen.getByText("Asha Rao")).toBeInTheDocument());
    expect(screen.getByRole("note")).toHaveTextContent("CSV includes only the 2 employees on this page.");
  });

  it("uses the singular wording for a one-row page", async () => {
    renderTable(ROWS);
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.getByRole("note")).toHaveTextContent("CSV includes only the 1 employee on this page.");
  });

  it("does not add its own client-side pager (the server Prev/Next is the single paginator)", async () => {
    const many: EmpRow[] = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, employeeNo: `E${i}`, name: `Person ${i}`, department: "HR", status: "confirmed", employeeType: "permanent" }));
    renderTable(many);
    await waitFor(() => expect(screen.getByText("Person 39")).toBeInTheDocument());
    expect(screen.queryByText(/Page \d+ of \d+/)).not.toBeInTheDocument();
    // header row + all 40 data rows: none hidden behind a nested pager.
    expect(screen.getAllByRole("row").length).toBe(41);
  });

  it("still shows the honest 'add your first employee' empty state for a genuinely empty roster", async () => {
    renderTable([], "api");
    await waitFor(() => expect(screen.getByText("Your team starts here")).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Add first employee" })).toBeInTheDocument();
  });

  it("falls back to a cached copy (not the error empty state) when one exists", async () => {
    readCacheMock.mockResolvedValue({ value: ROWS, cachedAt: new Date().toISOString() });
    renderTable([], "error");
    await waitFor(() => expect(screen.getByText("Priya Sharma")).toBeInTheDocument());
    expect(screen.queryByText("Couldn't load your team")).not.toBeInTheDocument();
  });
});
