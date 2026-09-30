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

/**
 * Data-corruption fix: bankAccountNo/bankIfsc come back from the API already
 * masked (pii-mask.ts maskValue -- "*******1234"), and this form's inputs
 * were seeded directly from that masked value. Saving the form for ANY
 * reason -- e.g. just correcting the mobile number -- used to include the
 * untouched masked placeholder in the outgoing patch, silently overwriting
 * the real stored bank account/IFSC with asterisks. These tests pin the fix:
 * an untouched masked field must never appear in the outgoing patch, while a
 * deliberate edit must still go through.
 */
describe("EditEmployeeForm — bank account / IFSC mask overwrite guard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const MASKED_EMPLOYEE = {
    ...EMPLOYEE,
    bankAccountNo: "*******2345",
    bankIfsc: "*******1234",
  };

  function renderForm() {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {/* @ts-expect-error minimal fixture, not the full EmployeeDetail type */}
        <EditEmployeeForm employee={MASKED_EMPLOYEE} />
      </NextIntlClientProvider>,
    );
  }

  it("does not include bankAccountNo/bankIfsc in the outgoing patch when those fields are left untouched", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderForm();
    // Touch an unrelated field so the form has *some* change to submit --
    // an empty patch short-circuits before the fetch call entirely.
    fireEvent.change(screen.getByLabelText(/mobile/i), { target: { value: "9123456780" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).not.toHaveProperty("bankAccountNo");
    expect(body).not.toHaveProperty("bankIfsc");
  });

  it("includes bankAccountNo/bankIfsc in the outgoing patch (plus the confirmed reason) when they are deliberately changed", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/bank account/i), { target: { value: "00099988877" } });
    fireEvent.change(screen.getByLabelText(/ifsc/i), { target: { value: "hdfc0001234" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    // GAP-HR-EMPLOYEES-DETAIL-EDIT-03: a bank/statutory change now requires
    // a typed reason via the shared ConfirmDialog before it submits at all.
    const reasonInput = await screen.findByLabelText(/reason for change/i);
    fireEvent.change(reasonInput, { target: { value: "Correcting a typo in account number" } });
    fireEvent.click(screen.getByRole("button", { name: /confirm change/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body.bankAccountNo).toBe("00099988877");
    expect(body.bankIfsc).toBe("HDFC0001234");
    expect(body.reason).toBe("Correcting a typo in account number");
  });

  /** GAP-HR-EMPLOYEES-DETAIL-EDIT-03 */
  it("does not submit a sensitive change without confirming a reason first", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 500 }));
    renderForm();
    fireEvent.change(screen.getByLabelText(/bank account/i), { target: { value: "00099988877" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await screen.findByLabelText(/reason for change/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  /**
   * GAP-HR-EMPLOYEES-DETAIL-EDIT-02: a leftover '*' means the field still
   * carries part of the masked placeholder, not a real edited value -- the
   * backend's isMaskedValue guard only catches a FULLY-masked string.
   */
  it("blocks submission client-side when a changed sensitive field still contains '*'", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/bank account/i), { target: { value: "1234*67890" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/masked value shown before/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/**
 * GAP-HR-EMPLOYEES-DETAIL-EDIT-02 (PHONE_RE blocking bug): mobile is seeded
 * from the API's already-masked value -- PHONE_RE has no '*' in its
 * character class, so an untouched masked phone used to fail validation on
 * EVERY save, blocking even an unrelated field change.
 */
describe("EditEmployeeForm — masked phone no longer blocks unrelated saves", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("saves an email-only change when the seeded phone is a masked placeholder", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 202 }));
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        {/* @ts-expect-error minimal fixture, not the full EmployeeDetail type */}
        <EditEmployeeForm employee={{ ...EMPLOYEE, phone: "******3210" }} />
      </NextIntlClientProvider>,
    );
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "new@example.gov.in" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(body).toEqual({ email: "new@example.gov.in" });
    expect(screen.queryByText(/fix the highlighted fields/i)).not.toBeInTheDocument();
  });
});
