import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { ArrearsTable, type ArrearTableColumn, type ArrearTableRow } from "./ArrearsTable";

const COLUMNS: ArrearTableColumn[] = [
  { key: "employee_label", label: "Employee" },
  { key: "difference_minor", label: "Amount", align: "right", cellType: "amount" },
  { key: "status", label: "Status", cellType: "status" },
];

const row = (over: Partial<ArrearTableRow>): ArrearTableRow => ({
  id: "a1", status: "pending", difference_minor: 50000, created_by: "maker", employee_label: "Ravi Kumar", component_label: "Basic Pay", ...over,
});

function renderTable(props: Partial<React.ComponentProps<typeof ArrearsTable>> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ArrearsTable columns={COLUMNS} rows={[row({})]} canDecide actorId="checker" approvalRequired {...props} />
    </NextIntlClientProvider>,
  );
}

describe("ArrearsTable (GAP-PAYROLL-ARREARS-03)", () => {
  beforeEach(() => refreshMock.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("offers Approve / Reject on a pending arrear to a payroll decider", () => {
    renderTable();
    expect(screen.getByRole("button", { name: "Approve arrear for Ravi Kumar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject arrear for Ravi Kumar" })).toBeInTheDocument();
  });

  it("shows no actions to a non-decider, and none on an already-decided arrear", () => {
    renderTable({ canDecide: false });
    expect(screen.queryByRole("button", { name: /Approve arrear/ })).not.toBeInTheDocument();
  });

  it("hides Approve from the arrear's creator when approval is required (maker != checker)", () => {
    renderTable({ actorId: "maker" });
    expect(screen.queryByRole("button", { name: /Approve arrear/ })).not.toBeInTheDocument();
    expect(screen.getByText("Needs another approver")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reject arrear/ })).toBeInTheDocument();
  });

  it("lets the creator approve once the tenant switched approval off", () => {
    renderTable({ actorId: "maker", approvalRequired: false });
    expect(screen.getByRole("button", { name: /Approve arrear/ })).toBeInTheDocument();
  });

  it("approves through POST /v1/payroll/arrears/:id/approve and refreshes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id: "a1", status: "accepted" }), { status: 202 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Approve arrear/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("v1/payroll/arrears/a1/approve");
    expect((fetchSpy.mock.calls[0]![1] as RequestInit).method).toBe("POST");
  });

  it("a rejection cannot be confirmed without a reason, and posts the note", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Reject arrear/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = screen.getAllByRole("button", { name: "Reject" }).at(-1)!;
    expect(confirm).toBeDisabled();
    fireEvent.change(dialog.querySelector("textarea")!, { target: { value: "duplicate of an earlier arrear" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    expect(String(fetchSpy.mock.calls[0]![0])).toContain("v1/payroll/arrears/a1/reject");
    expect(JSON.parse(String((fetchSpy.mock.calls[0]![1] as RequestInit).body))).toEqual({ note: "duplicate of an earlier arrear" });
  });

  it("shows the plain-sentence refusal when the server says SELF_APPROVAL_FORBIDDEN", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN" }), { status: 403 }));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /Approve arrear/ }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    expect(await screen.findByText(/You created this arrear, so another payroll user must decide it/)).toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
