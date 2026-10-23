import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

// The picker's directory adapters hit /api/proxy; stub them. resolve() is what
// labels a pre-selected id, so a lookup seeded with an employee id needs no typing.
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => []),
  resolveEmployees: vi.fn(async (ids: string[]) => ids.map((id) => ({ id, label: "Ravi Kumar (E-7)" }))),
}));

// Deterministic year list (the real helper starts at the current FY).
const fiscal = vi.hoisted(() => ({ recentFinancialYears: vi.fn((): string[] => ["2026-27", "2025-26", "2024-25"]) }));
vi.mock("@/lib/fiscalYear", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fiscalYear")>()),
  recentFinancialYears: fiscal.recentFinancialYears,
}));

import { EmployeeFyLookup } from "./EmployeeFyLookup";

const EMP = "7c1d2e3f-0000-4000-8000-000000000001";

function renderLookup(props: { employeeId: string; fy: string }) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EmployeeFyLookup {...props} />
    </NextIntlClientProvider>,
  );
}

describe("EmployeeFyLookup (GAP-PAYROLL-STATUTORY-PERQUISITE-05)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    fiscal.recentFinancialYears.mockReturnValue(["2026-27", "2025-26", "2024-25"]);
  });

  it("navigates with the picked employee's id and the selected valid FY", async () => {
    renderLookup({ employeeId: EMP, fy: "2025-26" });
    // the seeded employee is shown by name, not as a pasted id
    expect(await screen.findByDisplayValue(/Ravi Kumar/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View Form 12BA" }));
    await waitFor(() => expect(pushMock).toHaveBeenCalledTimes(1));
    expect(pushMock).toHaveBeenCalledWith(`/hr/payroll/statutory/perquisite?employeeId=${EMP}&fy=2025-26`);
  });

  it("the FY is a select of financial years defaulting to the current one, not free text", () => {
    renderLookup({ employeeId: EMP, fy: "" });
    const fy = screen.getByLabelText(/Financial Year/) as HTMLSelectElement;
    expect(fy.tagName).toBe("SELECT");
    expect(fy.value).toBe("2026-27");
    expect(Array.from(fy.options).map((o) => o.value)).toEqual(["2026-27", "2025-26", "2024-25"]);
  });

  it("an FY in the address that is not a listed year falls back to the current FY", () => {
    renderLookup({ employeeId: EMP, fy: "2026" });
    expect((screen.getByLabelText(/Financial Year/) as HTMLSelectElement).value).toBe("2026-27");
  });

  it("submitting without an employee shows the field error and does not navigate", () => {
    renderLookup({ employeeId: "", fy: "" });
    fireEvent.click(screen.getByRole("button", { name: "View Form 12BA" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Select an employee to look up.");
    expect(pushMock).not.toHaveBeenCalled();
  });

  it.each(["2026", "2026-28", "26-27"])("submitting an FY that is not a real financial year (%s) shows an error and does not navigate", (bad) => {
    // Defence in depth: even if the option list were corrupted, a malformed FY never reaches the URL.
    fiscal.recentFinancialYears.mockReturnValue([bad]);
    renderLookup({ employeeId: EMP, fy: "" });
    fireEvent.click(screen.getByRole("button", { name: "View Form 12BA" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Choose a valid financial year, for example 2026-27.");
    expect(pushMock).not.toHaveBeenCalled();
  });
});
