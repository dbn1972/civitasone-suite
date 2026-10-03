import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import { AllocateLeaveForm } from "./AllocateLeaveForm";

const EMPLOYEES = [{ id: "e1", name: "Test Employee", employeeNo: "EMP001", department: "Finance" }];
const LEAVE_TYPES = [{ id: "lt1", code: "EL", name: "Earned Leave" }];
const CONTEXT_EMPTY = { leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }], allocations: [] };

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AllocateLeaveForm />
    </NextIntlClientProvider>,
  );
}

function routeFetch(overrides: { onAllocate?: () => Response } = {}) {
  return vi.fn((url: string) => {
    if (typeof url === "string" && url.includes("/hrms/employees")) {
      return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
    }
    if (typeof url === "string" && url.includes("/hrms/leave-types")) {
      return Promise.resolve(new Response(JSON.stringify({ data: LEAVE_TYPES }), { status: 200 }));
    }
    if (typeof url === "string" && url.includes("/hrms/leave-context")) {
      return Promise.resolve(new Response(JSON.stringify(CONTEXT_EMPTY), { status: 200 }));
    }
    if (typeof url === "string" && url.includes("/hrms/leave-allocations")) {
      return Promise.resolve(overrides.onAllocate ? overrides.onAllocate() : new Response(JSON.stringify({ id: "a1", status: "accepted", correlationId: "c1" }), { status: 202 }));
    }
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}

/** GAP-HR-LEAVE-ALLOCATE-01: the confirm dialog now collects a reason (required to enable Allocate). */
function confirmWithReason(dialog: HTMLElement, reason = "Annual entitlement") {
  fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: reason } });
  fireEvent.click(within(dialog).getByRole("button", { name: /^allocate$/i }));
}

function allocationBody(fetchMock: ReturnType<typeof routeFetch>): Record<string, unknown> | null {
  const call = fetchMock.mock.calls.find(([u]) => typeof u === "string" && u.includes("leave-allocations"));
  return call ? JSON.parse(((call as unknown as [string, RequestInit])[1]).body as string) : null;
}

async function pickEmployee() {
  const input = screen.getByLabelText(/employee/i);
  fireEvent.change(input, { target: { value: "Test" } });
  const option = await screen.findByText("Test Employee (EMP001)");
  fireEvent.mouseDown(option);
}

describe("AllocateLeaveForm", () => {
  let fetchMock: ReturnType<typeof routeFetch>;
  beforeEach(() => {
    fetchMock = routeFetch();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  // GAP-HR-LEAVE-ALLOCATE-01
  it("starts with nothing preselected and blocks submit with validation errors, no network POST", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));

    expect(await screen.findByText(/please select an employee/i)).toBeInTheDocument();
    expect(screen.getByText(/please select a leave type/i)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("leave-allocations"))).toBe(false);
  });

  // GAP-HR-LEAVE-ALLOCATE-01
  it("requires confirming a dialog naming the employee/type/FY/days before the POST fires", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("12");
    expect(dialog).toHaveTextContent("Earned Leave");
    expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("leave-allocations"))).toBe(false);

    confirmWithReason(dialog);
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("leave-allocations"))).toBe(true));
  });

  // GAP-HR-LEAVE-ALLOCATE-01
  it("will not enable Allocate until a reason is given, then sends it (and no override within the cap)", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: /^allocate$/i })).toBeDisabled();
    confirmWithReason(dialog, "Annual entitlement");
    await waitFor(() => expect(allocationBody(fetchMock)).not.toBeNull());
    expect(allocationBody(fetchMock)).toEqual({ employeeId: "e1", leaveTypeId: "lt1", fy: expect.any(String), totalDays: 12, reason: "Annual entitlement" });
  });

  // GAP-HR-LEAVE-ALLOCATE-03
  it("above the policy maximum it sends the explicit override flag together with the reason", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
      if (url.includes("/hrms/leave-types")) return Promise.resolve(new Response(JSON.stringify({ data: LEAVE_TYPES }), { status: 200 }));
      if (url.includes("/hrms/leave-context")) return Promise.resolve(new Response(JSON.stringify({ leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }], allocations: [] }), { status: 200 }));
      return Promise.resolve(new Response(JSON.stringify({ id: "a1", status: "accepted" }), { status: 202 }));
    });
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "45" } });
    await screen.findByText(/policy maximum/i);
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent(/exceeding the policy maximum/i);
    confirmWithReason(dialog, "Special grant");
    await waitFor(() => expect(allocationBody(fetchMock)).not.toBeNull());
    expect(allocationBody(fetchMock)).toMatchObject({ totalDays: 45, reason: "Special grant", exceedMax: true });
  });

  // GAP-HR-LEAVE-ALLOCATE-03
  it("when the server refuses with EXCEEDS_TYPE_MAX (cap unknown to the form) it explains and the next confirm sends the override", async () => {
    let first = true;
    const base = routeFetch({
      onAllocate: () => {
        if (first) { first = false; return new Response(JSON.stringify({ code: "EXCEEDS_TYPE_MAX", message: "x" }), { status: 422 }); }
        return new Response(JSON.stringify({ id: "a1", status: "accepted" }), { status: 202 });
      },
    });
    // the leave-context call reports NO cap for this type, so the form cannot know it is over the maximum
    fetchMock = vi.fn((url: string, _init?: RequestInit) =>
      url.includes("/hrms/leave-context")
        ? Promise.resolve(new Response(JSON.stringify({ leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 0 }], allocations: [] }), { status: 200 }))
        : base(url)) as unknown as ReturnType<typeof routeFetch>;
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));
    const dialog = await screen.findByRole("alertdialog");
    confirmWithReason(dialog, "Special grant");
    await waitFor(() => expect(dialog).toHaveTextContent(/above the policy maximum/i));
    fireEvent.click(within(dialog).getByRole("button", { name: /^allocate$/i }));
    await waitFor(() => expect(screen.getByText(/allocation submitted/i)).toBeInTheDocument());
    const bodies = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>)
      .filter(([u]) => String(u).includes("leave-allocations"))
      .map(([, i]) => JSON.parse(i.body as string));
    expect(bodies[0]).not.toHaveProperty("exceedMax");
    expect(bodies[1]).toMatchObject({ exceedMax: true, reason: "Special grant" });
  });

  // GAP-HR-LEAVE-ALLOCATE-05
  it("resets the employee (not just the day count) after a successful allocation", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));
    const dialog = await screen.findByRole("alertdialog");
    confirmWithReason(dialog);

    await waitFor(() => expect(screen.getByText(/allocation submitted/i)).toBeInTheDocument());
    expect(screen.getByLabelText(/employee/i)).toHaveValue("");
    expect(screen.getByLabelText(/total days/i)).toHaveValue(null);
  });

  // GAP-HR-LEAVE-ALLOCATE-03
  it("shows the chosen employee's existing allocations and a soft over-cap warning, without blocking submit", async () => {
    fetchMock = routeFetch();
    fetchMock.mockImplementation((url: string) => {
      if (typeof url === "string" && url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
      if (typeof url === "string" && url.includes("/hrms/leave-types")) return Promise.resolve(new Response(JSON.stringify({ data: LEAVE_TYPES }), { status: 200 }));
      if (typeof url === "string" && url.includes("/hrms/leave-context")) {
        return Promise.resolve(new Response(JSON.stringify({
          leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }],
          allocations: [{ id: "a0", leaveTypeId: "lt1", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", fy: "2025-26", totalDays: 30, balanceDays: 10 }],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 202 }));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();

    expect(await screen.findByText("2025-26")).toBeInTheDocument(); // existing allocation shown
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "45" } }); // over the 30-day cap

    expect(await screen.findByText(/policy maximum/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /allocate leave/i })).not.toBeDisabled();
  });

  it("shows a clerk-safe message, never the raw server text or status, when allocation fails", async () => {
    fetchMock = routeFetch({ onAllocate: () => new Response("leave-service allocation trace at line 12", { status: 500 }) });
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));
    const dialog = await screen.findByRole("alertdialog");
    confirmWithReason(dialog);

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/leave-service/);
    expect(dialog.textContent).not.toMatch(/HTTP 500|status 500|\(500\)/);
  });

  // GAP-HR-LEAVE-ALLOCATE-01
  it("names the chosen employee in the confirm dialog", async () => {
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "12" } });
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).includes("ids=") || String(u).includes("e1"))).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /allocate leave/i }));
    const dialog = await screen.findByRole("alertdialog");
    await waitFor(() => expect(dialog).toHaveTextContent("Test Employee"));
    expect(dialog).not.toHaveTextContent("to this employee");
  });

  // GAP-HR-LEAVE-ALLOCATE-03
  it("warns (without blocking) when the employee already has this type + FY allocated", async () => {
    const { fiscalYearLabel, financialYearOf } = await import("@/lib/fiscalYear");
    const fy = fiscalYearLabel(Number(financialYearOf(new Date()).slice(0, 4)));
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 }));
      if (url.includes("/hrms/leave-types")) return Promise.resolve(new Response(JSON.stringify({ data: LEAVE_TYPES }), { status: 200 }));
      if (url.includes("/hrms/leave-context")) {
        return Promise.resolve(new Response(JSON.stringify({
          leaveTypes: [{ id: "lt1", code: "EL", name: "Earned Leave", maxDays: 30 }],
          allocations: [{ id: "a0", leaveTypeId: "lt1", leaveTypeCode: "EL", leaveTypeName: "Earned Leave", fy, totalDays: 30, balanceDays: 10 }],
        }), { status: 200 }));
      }
      return Promise.resolve(new Response("{}", { status: 202 }));
    });
    renderForm();
    await waitFor(() => expect(screen.getByRole("option", { name: /earned leave/i })).toBeInTheDocument());
    await pickEmployee();
    expect(screen.queryByTestId("already-allocated-warning")).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: /leave type/i }), { target: { value: "lt1" } });
    fireEvent.change(screen.getByLabelText(/total days/i), { target: { value: "5" } });
    expect(await screen.findByTestId("already-allocated-warning")).toHaveTextContent(/already has a Earned Leave allocation/i);
    expect(screen.getByRole("button", { name: /allocate leave/i })).toBeEnabled();
  });
});
