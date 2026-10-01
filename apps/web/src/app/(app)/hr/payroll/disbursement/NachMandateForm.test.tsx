import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// GAP-PAYROLL-DISBURSEMENT-08: the employee is now picked from the directory
// (EntityPicker over searchEmployees) instead of typed as a raw UUID.
const EMP = { id: "11111111-1111-1111-1111-111111111111", label: "Asha Rao (E042)" };
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => [EMP]),
  resolveEmployees: vi.fn(async () => []),
}));

import { NachMandateForm } from "./NachMandateForm";

// UX-017: NachMandateForm now reads its copy through next-intl
// (useTranslations("nachMandateForm")), so every render needs a real
// provider in the tree -- same pattern as
// hr/employees/[id]/edit/EditEmployeeForm.test.tsx.
function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <NachMandateForm />
    </NextIntlClientProvider>,
  );
}

async function fillMandateFields(amount = "5000") {
  fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "Asha" } });
  fireEvent.mouseDown(await screen.findByText(EMP.label));
  fireEvent.change(screen.getByLabelText(/Amount/), { target: { value: amount } });
  fireEvent.change(screen.getByLabelText(/Start Date/), { target: { value: "2026-08-01" } });
  fireEvent.change(screen.getByLabelText(/End Date/), { target: { value: "2027-08-01" } });
}

describe("NachMandateForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires the mandatory fields before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByText("Submit NACH Mandate"));
    expect(screen.getByText(/are required/)).toBeInTheDocument();
  });

  it("submits a mandate on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { umrn: "UMRN123", status: "submitted" } }), { status: 201 }),
    );

    renderForm();
    await fillMandateFields();
    fireEvent.click(screen.getByText("Submit NACH Mandate"));

    await waitFor(() => expect(screen.getByText("Submit this NACH mandate?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit mandate"));

    await waitFor(() => {
      expect(screen.getByText(/Mandate submitted \(UMRN UMRN123/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the submit confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    await fillMandateFields();
    fireEvent.click(screen.getByText("Submit NACH Mandate"));

    await waitFor(() => expect(screen.getByText("Submit this NACH mandate?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit mandate"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  it("requires a reference before checking mandate status", () => {
    renderForm();
    fireEvent.click(screen.getByText("Check Status"));
    expect(screen.getByText("Enter a mandate reference to check its status.")).toBeInTheDocument();
  });

  it("checks mandate status on submit (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { status: "active" } }), { status: 200 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/Check Mandate Status by Reference/), { target: { value: "REF-1" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText("Status: active")).toBeInTheDocument();
    });
  });

  // UX-016: this used to show the backend's raw `error.message` verbatim
  // ("mandate not found") — the same class of leak useFormError closes
  // fleet-wide (UX-003). It must now show the catalogued clerk-safe message
  // instead, never the raw server text.
  it("surfaces a clerk-safe message on the status lookup, never the raw server text (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "mandate not found" } }), { status: 404 }),
    );

    renderForm();
    fireEvent.change(screen.getByLabelText(/Check Mandate Status by Reference/), { target: { value: "REF-missing" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't check the status/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("mandate not found")).not.toBeInTheDocument();
    expect(screen.queryByText(/NOT_FOUND/)).not.toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code on a plain-text status-lookup failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));

    renderForm();
    fireEvent.change(screen.getByLabelText(/Check Mandate Status by Reference/), { target: { value: "REF-2" } });
    fireEvent.click(screen.getByText("Check Status"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't check the status/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/\b500\b/)).not.toBeInTheDocument();
  });

  it("[GAP-PAYROLL-DISBURSEMENT-08] posts amountMinor as an exact paise string and the picked employee id", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { umrn: "UMRN9", status: "submitted" } }), { status: 201 }),
    );
    renderForm();
    await fillMandateFields("1234.56");
    fireEvent.click(screen.getByText("Submit NACH Mandate"));
    await waitFor(() => expect(screen.getByText("Submit this NACH mandate?")).toBeInTheDocument());
    // The confirm text names the employee, not a UUID, and shows the exact amount.
    expect(screen.getByText(EMP.label)).toBeInTheDocument();
    expect(screen.getByText(/₹1,234\.56/)).toBeInTheDocument();
    fireEvent.click(screen.getByText("Submit mandate"));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body));
    expect(body.amountMinor).toBe("123456");
    expect(body.employeeRef).toBe(EMP.id);
  });

  it("[GAP-PAYROLL-DISBURSEMENT-08] rejects an amount with more than 2 decimals instead of rounding it", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    renderForm();
    await fillMandateFields("1.005");
    // A real browser's native step="0.01" validation already blocks this on
    // click; submit the form directly to prove the JS guard is a backstop
    // (paste, autofill, older browsers) rather than relying on that.
    fireEvent.submit(screen.getByText("Submit NACH Mandate").closest("form") as HTMLFormElement);
    expect(screen.getByText(/at most 2 decimal places/)).toBeInTheDocument();
    expect(screen.queryByText("Submit this NACH mandate?")).not.toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
