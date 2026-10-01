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

    fireEvent.click(within(dialog).getByRole("button", { name: /^allocate$/i }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => typeof u === "string" && u.includes("leave-allocations"))).toBe(true));
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
    fireEvent.click(within(dialog).getByRole("button", { name: /^allocate$/i }));

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
    fireEvent.click(within(dialog).getByRole("button", { name: /^allocate$/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/leave-service/);
    expect(dialog.textContent).not.toMatch(/\b500\b/);
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
