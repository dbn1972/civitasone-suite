import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

const EMP_ID = "11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => [{ id: EMP_ID, label: "Asha Rao (EMP-001)", sublabel: "Finance" }]),
  resolveEmployees: vi.fn(async () => []),
}));

import { CreateLoanForm } from "./CreateLoanForm";

// UX-017: CreateLoanForm is now translated (useTranslations("createLoanForm")),
// so every render needs a real NextIntlClientProvider in the tree.
function renderForm(currentEmpId = "") {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CreateLoanForm currentEmpId={currentEmpId} />
    </NextIntlClientProvider>,
  );
}

async function pickEmployee() {
  fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "Asha" } });
  fireEvent.mouseDown(await screen.findByText("Asha Rao (EMP-001)"));
  await screen.findByDisplayValue("Asha Rao (EMP-001)");
}

async function fillFields(over: Partial<Record<"principal" | "emi" | "tenure", string>> = {}) {
  fireEvent.change(screen.getByLabelText(/Loan No\./), { target: { value: "LN-99" } });
  await pickEmployee();
  fireEvent.change(screen.getByLabelText(/Principal/), { target: { value: over.principal ?? "10000" } });
  fireEvent.change(screen.getByLabelText(/^EMI/), { target: { value: over.emi ?? "1000" } });
  fireEvent.change(screen.getByLabelText(/Tenure/), { target: { value: over.tenure ?? "12" } });
}

describe("CreateLoanForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
    pushMock.mockReset();
  });

  it("requires the mandatory fields before opening the confirm dialog", () => {
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));
    expect(screen.getByText(/are required/)).toBeInTheDocument();
  });

  it("has no field labelled UUID (GAP-PAYROLL-LOANS-01)", () => {
    renderForm();
    expect(screen.queryByLabelText(/UUID/)).not.toBeInTheDocument();
  });

  it("confirm dialog names the employee and formats money -- never a raw id (GAP-PAYROLL-LOANS-01)", async () => {
    renderForm();
    await fillFields({ principal: "10000.50" });
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Asha Rao (EMP-001)");
    expect(dialog).toHaveTextContent("₹10,000.50");
    expect(dialog).not.toHaveTextContent(EMP_ID);
  });

  it("rejects EMI x tenure below principal (GAP-PAYROLL-LOANS-05)", async () => {
    renderForm();
    await fillFields({ principal: "1000", emi: "100", tenure: "2" });
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));
    expect(screen.getByText("EMI × tenure must cover at least the principal.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("rejects an amount with more than 2 decimals instead of rounding it (GAP-PAYROLL-LOANS-05)", async () => {
    renderForm();
    await fillFields({ principal: "1.005" });
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));
    expect(screen.getByText(/at most 2 decimal places/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Principal/)).toHaveAttribute("aria-invalid", "true");
  });

  it("creates a loan with exact paise + an idempotency key, then navigates to that employee", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "loan-1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    renderForm();
    await fillFields({ principal: "10000.10", emi: "1000.01" });
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));

    await waitFor(() => expect(screen.getByText("Create this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create loan"));

    await waitFor(() => {
      expect(screen.getByText(/Loan LN-99 for Asha Rao \(EMP-001\) submitted/)).toBeInTheDocument();
    });
    const [, init] = fetchSpy.mock.calls.find(([url]) => String(url).includes("v1/payroll/loans"))!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({ employeeId: EMP_ID, principalMinor: 1000010, emiMinor: 100001, tenureMonths: 12 });
    expect(((init as RequestInit).headers as Record<string, string>)["x-idempotency-key"]).toBeTruthy();
    expect(pushMock).toHaveBeenCalledWith(`/hr/payroll/loans?empId=${EMP_ID}`);
  });

  it("refreshes instead of navigating when the page already shows that employee", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "loan-1", status: "accepted" }), { status: 202 }),
    );
    renderForm(EMP_ID);
    await fillFields();
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));
    await waitFor(() => expect(screen.getByText("Create this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create loan"));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("explains a duplicate loan number (409 LOAN_NO_TAKEN)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "LOAN_NO_TAKEN", message: "loan number LN-99 is already in use" }), { status: 409 }),
    );
    renderForm();
    await fillFields();
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));
    await waitFor(() => expect(screen.getByText("Create this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create loan"));
    await waitFor(() => {
      expect(screen.getByText("Loan number LN-99 is already in use. Enter a different loan number.")).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm();
    await fillFields();
    fireEvent.click(screen.getByRole("button", { name: "Create Loan" }));

    await waitFor(() => expect(screen.getByText("Create this loan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create loan"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });
});
