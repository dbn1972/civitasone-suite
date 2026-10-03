import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { PerquisiteTable } from "./PerquisiteTable";

const LINES = [
  { sl: 1, id: "c-1", nature: "car", description: "Pool car", valueByEmployerMinor: 100000, amountRecoveredMinor: 10000, taxableValueMinor: 90000, value: 900 },
  { sl: 2, nature: "Aggregate value of perquisites u/s 17(2)", description: "", taxableValueMinor: 5000, value: 50 },
];

function renderTable(props: Partial<React.ComponentProps<typeof PerquisiteTable>> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PerquisiteTable perquisites={LINES} employeeId="emp-1" fy="2026-27" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("PerquisiteTable row actions (GAP-PAYROLL-STATUTORY-PERQUISITE-06)", () => {
  beforeEach(() => refreshMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("Edit links to the same employee/FY with ?edit=<component id>", () => {
    renderTable();
    const link = screen.getByRole("link", { name: "Edit Car" });
    expect(link.getAttribute("href")).toBe("/hr/payroll/statutory/perquisite?employeeId=emp-1&fy=2026-27&edit=c-1");
  });

  it("the aggregate fall-back line has nothing to edit or delete", () => {
    renderTable();
    expect(screen.getAllByRole("link", { name: /^Edit/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Delete/ })).toHaveLength(1);
  });

  it("a read-only viewer sees no actions", () => {
    renderTable({ canModify: false });
    expect(screen.queryByRole("link", { name: /^Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete/ })).not.toBeInTheDocument();
  });

  it("delete needs a reason, then posts it to the audited delete endpoint and refreshes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "c-1", status: "accepted" }), { status: 202 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Delete Car" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = screen.getByRole("button", { name: "Delete component" });
    expect(confirm).toBeDisabled();
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "entered by mistake" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("v1/payroll/statutory/perquisite-components/c-1/delete");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({ reason: "entered by mistake" });
  });

  it("a failed delete keeps the dialog open with an error and does not refresh", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: "Delete Car" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "entered by mistake" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete component" }));
    await waitFor(() => expect(screen.getByRole("alertdialog")).toHaveTextContent(/couldn't|could not|try again/i));
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
