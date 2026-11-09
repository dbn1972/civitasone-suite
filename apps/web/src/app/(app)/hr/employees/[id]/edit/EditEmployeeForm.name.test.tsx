/**
 * UAT b23: HR can correct the employee's name from the edit form. The change is sent with a
 * mandatory reason (shared ConfirmDialog), only when the name actually changed; blanking a real
 * name is refused client-side.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EditEmployeeForm } from "./EditEmployeeForm";

const EMPLOYEE = {
  id: "e1",
  employeeId: "EMP001",
  name: "Sunita Devi",
  department: "Establishment",
  designation: "Section Officer",
  status: "active",
  phone: "9876543210",
  email: "sunita.devi@morth.gov.in",
  reportingTo: "",
};

describe("EditEmployeeForm — name correction", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  function renderForm() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {/* @ts-expect-error minimal fixture, not the full EmployeeDetail type */}
        <EditEmployeeForm employee={EMPLOYEE} />
      </NextIntlClientProvider>,
    );
  }

  it("shows the current name in an editable Full name field", () => {
    renderForm();
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe("Sunita Devi");
  });

  it("asks for a reason before sending a changed name, then sends fullName (trimmed) with the reason", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "  Sunita Kumari  " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    const reasonInput = await screen.findByLabelText(/reason for change/i);
    expect(screen.getByText(/confirm name correction/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(reasonInput, { target: { value: "Name changed after marriage" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm change/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.fullName).toBe("Sunita Kumari");
    expect(body.reason).toBe("Name changed after marriage");
  });

  it("does not send fullName when the name is untouched (an email-only save)", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "sunita.kumari@morth.gov.in" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ email: "sunita.kumari@morth.gov.in" });
  });

  it("refuses a blanked-out name client-side and sends nothing", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/full name/i), { target: { value: "    " } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/enter the employee's full name/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
