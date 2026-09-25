import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess, error: vi.fn(), info: vi.fn() } }),
}));

import { InitiateSeparationAction } from "./InitiateSeparationAction";

/**
 * HIGH fix regression test: separation had zero reachable UI anywhere
 * despite PATCH /v1/hrms/employees/:id/separate already working. Covers
 * the create action this component adds, mirroring
 * TransferWithApproval.test.tsx's harness.
 */
const EMPLOYEES = [
  { id: "emp-1", fullName: "Asha Verma", employeeNo: "E001", department: "Finance", status: "confirmed" },
  { id: "emp-2", fullName: "Ravi Kumar", employeeNo: "E002", department: "Works", status: "confirmed" },
  { id: "emp-3", fullName: "Already Gone", employeeNo: "E003", department: "Health", status: "separated" },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function renderAction(props: Partial<React.ComponentProps<typeof InitiateSeparationAction>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <InitiateSeparationAction {...props} />
    </NextIntlClientProvider>,
  );
}

describe("InitiateSeparationAction", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    toastSuccess.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts closed, and opens the form on click", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: EMPLOYEES }));
    renderAction();

    expect(screen.queryByText("Initiate employee separation")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "+ Initiate Separation" }));
    expect(await screen.findByText("Initiate employee separation")).toBeInTheDocument();
  });

  it("excludes already-exited employees from the picker (backend has no re-separation guard)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: EMPLOYEES }));
    renderAction();
    fireEvent.click(screen.getByRole("button", { name: "+ Initiate Separation" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees?limit=500",
      expect.anything(),
    ));

    const select = await screen.findByLabelText("Employee", { selector: "select" });
    expect(within(select).getByText(/Asha Verma/)).toBeInTheDocument();
    expect(within(select).getByText(/Ravi Kumar/)).toBeInTheDocument();
    expect(within(select).queryByText(/Already Gone/)).not.toBeInTheDocument();
  });

  it("prefilled from ?empId= shows a locked, read-only employee field and never fetches the picker", async () => {
    renderAction({ prefillEmployeeId: "emp-1", prefillEmployeeName: "Asha Verma", prefillEmployeeStatus: "confirmed" });
    fireEvent.click(screen.getByRole("button", { name: "+ Initiate Separation" }));

    const input = await screen.findByDisplayValue("Asha Verma");
    expect(input).toBeDisabled();
    expect(fetchMock).not.toHaveBeenCalledWith("/api/proxy/v1/hrms/employees?limit=500", expect.anything());
  });

  // SEC CRITICAL regression (PR #1572 fix-up round): a direct navigation to
  // /hr/retirement?empId=<already-exited-id> used to reach this exact same
  // locked-but-submittable form (previous test) unconditionally -- nothing
  // here re-checked the employee's actual current status. See this
  // component's module doc comment for the full writeup; the backend
  // PATCH .../separate route now also independently guards this (the real
  // fix), this is the UI-layer half.
  it.each(["terminated", "separated", "retired"])(
    "prefilled from ?empId= for an already-exited employee (status '%s') shows a guarded notice, never the form",
    async (status) => {
      renderAction({ prefillEmployeeId: "emp-3", prefillEmployeeName: "Already Gone", prefillEmployeeStatus: status });

      expect(screen.getByText(`Already Gone has already exited (status: ${status}) and cannot be separated again.`)).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "+ Initiate Separation" })).not.toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("an exited status is matched case-insensitively (mirrors EXITED_STATUSES.has elsewhere)", async () => {
    renderAction({ prefillEmployeeId: "emp-3", prefillEmployeeName: "Already Gone", prefillEmployeeStatus: "SEPARATED" });
    expect(screen.getByText(/has already exited/)).toBeInTheDocument();
  });

  it("disables submit until an employee and effective date are set, with a visible reason", async () => {
    renderAction({ prefillEmployeeId: "emp-1", prefillEmployeeName: "Asha Verma" });
    fireEvent.click(screen.getByRole("button", { name: "+ Initiate Separation" }));
    await screen.findByDisplayValue("Asha Verma");

    expect(screen.getByRole("button", { name: "Initiate separation" })).toBeDisabled();
    expect(screen.getByText("Effective date is required.")).toBeInTheDocument();
  });

  it("submits PATCH .../separate with the form body after confirming, then toasts and closes", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("/separate")) return Promise.resolve(jsonResponse({ id: "sep-1", status: "accepted" }, 202));
      return Promise.resolve(jsonResponse({ data: [] }));
    });
    renderAction({ prefillEmployeeId: "emp-1", prefillEmployeeName: "Asha Verma" });
    fireEvent.click(screen.getByRole("button", { name: "+ Initiate Separation" }));
    await screen.findByDisplayValue("Asha Verma");

    fireEvent.change(screen.getByLabelText("Effective date"), { target: { value: "2026-12-31" } });
    const submit = screen.getByRole("button", { name: "Initiate separation" });
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);

    fireEvent.click(await screen.findByRole("button", { name: "Confirm separation" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/employees/emp-1/separate",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          separationType: "resignation",
          effectiveDate: "2026-12-31",
          lastWorkingDate: undefined,
          encashmentDays: 0,
          remarks: undefined,
        }),
      }),
    ));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Separation recorded for Asha Verma."));
  });
});
