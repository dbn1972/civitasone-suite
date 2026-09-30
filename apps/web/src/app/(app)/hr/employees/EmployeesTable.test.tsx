import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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

function renderTable(employees: EmpRow[], source: "api" | "error", canCreate = true) {
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

  /** GAP-HR-EMPLOYEES-05: employeeType was returned by the API but never rendered. */
  it("renders an Employee Type column", async () => {
    renderTable(ROWS, "api");
    expect(screen.getByRole("columnheader", { name: "Type" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("permanent")).toBeInTheDocument());
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
