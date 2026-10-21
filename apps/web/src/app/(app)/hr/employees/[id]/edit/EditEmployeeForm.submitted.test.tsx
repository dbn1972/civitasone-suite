import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: refreshMock }) }));

const searchEmployeesMock = vi.fn();
// MANAGER_INELIGIBLE_STATUSES lives in the adapter module (shared with the Add Employee wizard manager
// picker); keep the real constant so this test also pins the exact list the form sends.
vi.mock("@/lib/entityAdapters/employee", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/entityAdapters/employee")>()),
  searchEmployees: (...a: unknown[]) => searchEmployeesMock(...a),
  resolveEmployees: vi.fn(async () => []),
}));
vi.mock("@/lib/entityAdapters/payStructure", () => ({
  searchPayStructures: vi.fn(async () => []),
  resolvePayStructures: vi.fn(async () => []),
}));

import { EditEmployeeForm } from "./EditEmployeeForm";

const EMPLOYEE = {
  id: "e1", employeeId: "EMP001", department: "IT", designation: "Assistant", status: "confirmed",
  phone: "9876543210", email: "old@example.gov.in", reportingTo: "",
};

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {/* @ts-expect-error minimal fixture, not the full EmployeeDetail type */}
      <EditEmployeeForm employee={EMPLOYEE} />
    </NextIntlClientProvider>,
  );
}

describe("EditEmployeeForm — after a successful save (GAP-HR-EMPLOYEES-DETAIL-EDIT-06)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    pushMock.mockReset();
    refreshMock.mockReset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(new Response("", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  async function saveEmailChange() {
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "new@example.gov.in" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await screen.findByText(/Update submitted\./);
  }

  it("keeps Save and Cancel disabled once the update was accepted, so a second submit cannot go out", async () => {
    renderForm();
    await saveEmailChange();
    expect(screen.getByRole("button", { name: /save changes/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    fireEvent.submit(screen.getByRole("form", { name: "Edit employee" }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not claim a redirect that never happens", async () => {
    renderForm();
    await saveEmailChange();
    expect(screen.queryByText(/redirecting/i)).not.toBeInTheDocument();
  });

  it("never navigates on a timer: nothing happens until the user clicks Continue", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderForm();
    await saveEmailChange();
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(pushMock).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("Continue goes to the profile with ?updated=1 (so the profile reads fresh data) and refreshes", async () => {
    renderForm();
    await saveEmailChange();
    fireEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(pushMock).toHaveBeenCalledWith("/hr/employees/e1?updated=1");
    expect(refreshMock).toHaveBeenCalled();
  });
});

describe("EditEmployeeForm — manager picker (GAP-HR-EMPLOYEES-DETAIL-EDIT-05)", () => {
  beforeEach(() => { searchEmployeesMock.mockReset(); });

  it("asks the directory to exclude exited staff and to fail loudly, never listing the employee themself", async () => {
    searchEmployeesMock.mockResolvedValue([
      { id: "e1", label: "Self Person (EMP001)" },
      { id: "m9", label: "Meena Rao (EMP009)" },
    ]);
    renderForm();
    fireEvent.change(screen.getByRole("combobox", { name: "Manager" }), { target: { value: "Rao" } });
    await waitFor(() => expect(searchEmployeesMock).toHaveBeenCalled());
    expect(searchEmployeesMock).toHaveBeenCalledWith("Rao", expect.any(AbortSignal), {
      excludeStatuses: ["terminated", "separated", "retired"],
      strict: true,
    });
    expect(await screen.findByText("Meena Rao (EMP009)")).toBeInTheDocument();
    expect(screen.queryByText("Self Person (EMP001)")).not.toBeInTheDocument();
  });

  it("shows a 'couldn't load' alert, not 'No matches', when the lookup fails", async () => {
    searchEmployeesMock.mockRejectedValue(new Error("entity lookup failed"));
    renderForm();
    fireEvent.change(screen.getByRole("combobox", { name: "Manager" }), { target: { value: "Rao" } });
    expect(await screen.findByText("Couldn't load employees. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).not.toBeInTheDocument();
  });
});
