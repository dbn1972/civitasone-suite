import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EditEmployeeForm } from "./EditEmployeeForm";

const EMPLOYEE = {
  id: "e1",
  employeeId: "EMP001",
  department: "IT",
  designation: "Assistant",
  status: "active",
  phone: "9876543210",
  email: "old@example.gov.in",
  reportingTo: "",
};

/**
 * UX-016: this used to show the raw backend `message` (falling back to
 * `Update failed (${res.status})`) verbatim — the same class of leak
 * useFormError closes fleet-wide (UX-003).
 */
describe("EditEmployeeForm — UX-016 clerk-safe errors", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  // UX-017: EditEmployeeForm now reads its copy through next-intl
  // (useTranslations("employeeEdit")), so it needs a real provider in the
  // tree — same pattern as citizen/grievances/GrievancesTable.test.tsx and
  // hr/leave/approvals/LeaveApprovalsPanel.test.tsx.
  function fillAndSubmit() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {/* @ts-expect-error minimal fixture, not the full EmployeeDetail type */}
        <EditEmployeeForm employee={EMPLOYEE} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/mobile/i), { target: { value: "9123456780" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
  }

  it("shows a clerk-safe message, never the raw HTTP status, when saving fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    fillAndSubmit();

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/\b500\b/);
  });

  it("renders an inline field-level message from a fieldErrors response next to the offending field", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "mobile", message: "Mobile number is already in use." }],
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    fillAndSubmit();

    expect(await screen.findByText("Mobile number is already in use.")).toBeInTheDocument();
  });
});
