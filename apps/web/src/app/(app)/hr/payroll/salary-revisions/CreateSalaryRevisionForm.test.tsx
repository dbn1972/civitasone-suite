import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

// GAP-PAYROLL-SALARY-REVISIONS-03: the employee field is now the shared
// EntityPicker (its own search/debounce/keyboard-nav behaviour is already
// covered by EntityPicker.test.tsx) -- only its two data adapters are
// mocked here, so this file drives the real rendered combobox exactly like
// a clerk would, instead of re-testing EntityPicker's own internals.
const searchEmployeesMock = vi.fn();
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: (...args: unknown[]) => searchEmployeesMock(...args),
  resolveEmployees: vi.fn().mockResolvedValue([]),
}));

import { CreateSalaryRevisionForm } from "./CreateSalaryRevisionForm";

function renderForm(secondApprover?: boolean) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateSalaryRevisionForm {...(secondApprover === undefined ? {} : { secondApprover })} />
    </NextIntlClientProvider>,
  );
}

/** Types into the employee EntityPicker and clicks the first search result. */
async function pickEmployee(label: string, id: string) {
  searchEmployeesMock.mockResolvedValue([{ id, label }]);
  fireEvent.change(screen.getByRole("combobox", { name: /Employee ID/i }), { target: { value: label } });
  const option = await screen.findByRole("option", { name: label });
  fireEvent.mouseDown(option);
}

async function fillValidForm() {
  await pickEmployee("Asha Verma", "e1");
  fireEvent.change(screen.getByLabelText(/^Effective Date/), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText(/^Old Basic/), { target: { value: "40000" } });
  fireEvent.change(screen.getByLabelText(/^New Basic/), { target: { value: "44000" } });
  fireEvent.change(screen.getByLabelText(/^Old Gross/), { target: { value: "80000" } });
  fireEvent.change(screen.getByLabelText(/^New Gross/), { target: { value: "88000" } });
  fireEvent.change(screen.getByLabelText(/^Order No/), { target: { value: "ORD/2026/17" } });
}

describe("CreateSalaryRevisionForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
    searchEmployeesMock.mockReset();
  });

  it("requires an employee to be selected before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText("Select an employee.")).toBeInTheDocument();
  });

  it("requires a valid effective date", async () => {
    renderForm();
    await pickEmployee("Asha Verma", "e1");
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText("Effective date must be in YYYY-MM-DD format.")).toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-REVISIONS-03: old_basic/old_gross used to be
  // optional and silently sent as 0 when left blank -- a real, false
  // "old basic was ₹0" record for an employee whose actual old basic just
  // wasn't entered. They're required fields now (0 is still a valid,
  // explicit entry for someone who truly had none).
  it("requires an old basic amount", async () => {
    renderForm();
    await pickEmployee("Asha Verma", "e1");
    fireEvent.change(screen.getByLabelText(/^Effective Date/), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText(/Old basic must be entered/)).toBeInTheDocument();
  });

  // PR #1756 review M1: the old-basic/old-gross error copy says "0 if there
  // truly was none", and the backend takes nonnegative() for both -- but the
  // form used to reject "0" with that same error, an unbreakable loop.
  it("accepts an explicit 0 for old basic and old gross (first-ever pay fixation) and POSTs 0", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "sr1", status: "accepted" }), { status: 202 }),
    );
    renderForm();
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/^Old Basic/), { target: { value: "0" } });
    fireEvent.change(screen.getByLabelText(/^Old Gross/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.queryByText(/Old basic must be entered/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Old gross must be entered/)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Record this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record revision"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("v1/payroll/salary-revisions"));
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.oldBasicMinor).toBe(0);
    expect(body.oldGrossMinor).toBe(0);
  });

  it("still rejects a negative old basic", async () => {
    renderForm();
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/^Old Basic/), { target: { value: "-1" } });
    // Dispatch submit directly: the input's native min="0" constraint would
    // otherwise block a click-submit before the JS parser is even reached.
    fireEvent.submit(screen.getByRole("button", { name: "Record Revision" }).closest("form")!);
    expect(screen.getByText(/Old basic must be entered/)).toBeInTheDocument();
  });

  it("requires a positive new basic amount", async () => {
    renderForm();
    await pickEmployee("Asha Verma", "e1");
    fireEvent.change(screen.getByLabelText(/^Effective Date/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^Old Basic/), { target: { value: "40000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText("New basic must be a positive value in rupees.")).toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-REVISIONS-03: previously unvalidated -- a "new"
  // basic below "old" (other than an explicit correction) almost certainly
  // means old/new got swapped or mistyped.
  it("rejects a new basic below old basic unless the revision type is 'correction'", async () => {
    renderForm();
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/^New Basic/), { target: { value: "30000" } }); // below old (40000)
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText(/New basic is below old basic/)).toBeInTheDocument();
  });

  it("allows a new basic below old basic when the revision type is 'correction'", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "sr1", status: "accepted" }), { status: 202 }),
    );
    renderForm();
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/^Revision Type/), { target: { value: "correction" } });
    fireEvent.change(screen.getByLabelText(/^New Basic/), { target: { value: "30000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    await waitFor(() => expect(screen.getByText("Record this salary revision?")).toBeInTheDocument());
    expect(screen.queryByText(/New basic is below old basic/)).not.toBeInTheDocument();
    void fetchSpy;
  });

  it("rejects a new gross below new basic", async () => {
    renderForm();
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/^New Gross/), { target: { value: "40000" } }); // below new basic (44000)
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText(/New gross cannot be less than new basic/)).toBeInTheDocument();
  });

  it("creates a salary revision on confirm (happy path), POSTing minor-unit amounts for a real employee id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "sr1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderForm();
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));

    await waitFor(() => expect(screen.getByText("Record this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record revision"));

    await waitFor(() => {
      // PR #1756 review: the write is async (202 + consumer), so the copy
      // says "submitted ... will appear shortly", not "recorded".
      // fin-payroll-03: second approver is ON by default, so the copy says the
      // revision now waits for a different payroll user.
      expect(screen.getByText(/Salary revision to .* submitted\. It is saved in the background and then waits for approval by a different payroll user/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    // The route this wires up (POST /v1/payroll/salary-revisions) takes
    // amounts in minor units (paise) -- rupees typed in the form must be
    // converted, not sent as-is, and never via float multiplication (see
    // rupeesToMinorString's own doc comment on why Math.round(x*100) is
    // unsafe).
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("v1/payroll/salary-revisions"));
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.employeeId).toBe("e1"); // the picker's id, not the typed label
    expect(body.effectiveDate).toBe("2026-08-01");
    expect(body.oldBasicMinor).toBe(4000000);
    expect(body.newBasicMinor).toBe(4400000);
    expect(body.oldGrossMinor).toBe(8000000);
    expect(body.newGrossMinor).toBe(8800000);
    expect(body.revisionType).toBe("annual_increment");
  });

  it("with the tenant's second-approver switch OFF the confirmation keeps the 'appears shortly' copy", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "sr1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );
    renderForm(false);
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    await waitFor(() => expect(screen.getByText("Record this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record revision"));
    await waitFor(() => {
      expect(screen.getByText(/Salary revision to .* for employee e1 submitted\. It is saved in the background and will appear/)).toBeInTheDocument();
    });
    expect(screen.queryByText(/waits for approval/)).not.toBeInTheDocument();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    renderForm();
    await fillValidForm();
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));

    await waitFor(() => expect(screen.getByText("Record this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record revision"));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 400/)).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-SALARY-REVISIONS-02: an order number is required before the confirm dialog opens", async () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><CreateSalaryRevisionForm /></NextIntlClientProvider>);
    await fillValidForm();
    fireEvent.change(screen.getByLabelText(/^Order No/), { target: { value: "  " } });
    fireEvent.click(screen.getByRole("button", { name: /Record Revision|Create|Submit/i }));
    expect(await screen.findByText("Enter the order number that sanctions this revision.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
