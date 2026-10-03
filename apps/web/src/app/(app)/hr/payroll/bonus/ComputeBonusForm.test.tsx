import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

// GAP-PAYROLL-BONUS-01: the employee is picked through the shared EntityPicker
// + searchEmployees adapter (mocked here), never typed as a UUID.
const EMP = { id: "33333333-3333-4333-8333-333333333301", label: "Ravi Kumar (EMP-0042)" };
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async (q: string) => (EMP.label.toLowerCase().includes(q.toLowerCase()) ? [EMP] : [])),
  resolveEmployees: vi.fn(async () => []),
}));

import { ComputeBonusForm } from "./ComputeBonusForm";

function renderForm() {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ComputeBonusForm />
    </NextIntlClientProvider>,
  );
}

async function pickEmployee() {
  fireEvent.change(screen.getByLabelText(/^Employee/), { target: { value: "Ravi" } });
  fireEvent.mouseDown(await screen.findByText(EMP.label));
}

function accepted() {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
    new Response(JSON.stringify({ id: "b1", status: "accepted", correlationId: "c1" }), { status: 202 }),
  );
}

/** GET /v1/payroll/bonus/basic answers with the HRMS basic (+ rule); anything else is the 202 envelope. */
function withBasic(basicMinor: string, rule: { wageCeilingMinor: string | null; eligibilityCeilingMinor: string | null } | null = null) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).includes("v1/payroll/bonus/basic") && (init as RequestInit | undefined)?.method !== "POST") {
      return new Response(JSON.stringify({ employeeId: EMP.id, basicMinor, rule, source: "hrms_payroll_input" }), { status: 200 });
    }
    return new Response(JSON.stringify({ id: "b1", status: "accepted" }), { status: 202 });
  });
}

describe("ComputeBonusForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("has no free-text Employee ID input", () => {
    renderForm();
    expect(screen.queryByLabelText(/Employee ID/)).not.toBeInTheDocument();
  });

  it("blocks submit with an inline error until an employee is picked", () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "21000" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Select an employee.");
    expect(screen.queryByText("Compute this bonus?")).not.toBeInTheDocument();
  });

  it.each([["8.32"], ["20.01"], [""], ["abc"]])("rejects bonus %% %s without opening the dialog (GAP-PAYROLL-BONUS-03)", async (pct) => {
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "21000" } });
    fireEvent.change(screen.getByLabelText(/^Bonus %/), { target: { value: pct } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Bonus % must be between 8.33 and 20");
    expect(screen.queryByText("Compute this bonus?")).not.toBeInTheDocument();
  });

  it("rejects a basic with more than 2 decimals (no float rounding, GAP-PAYROLL-BONUS-02)", async () => {
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "1.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    expect(document.querySelector(".pill.bad")).toHaveTextContent("Basic salary must be a positive amount in rupees.");
  });

  it("confirms with the employee's name, posts paise + exact percent, and handles the 202 envelope", async () => {
    const fetchSpy = withBasic("2100000");
    renderForm();
    await pickEmployee();
    await waitFor(() => expect((screen.getByLabelText(/^Basic Salary/) as HTMLInputElement).value).toBe("21000.00"));
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "21000" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Ravi Kumar (EMP-0042)");
    expect(dialog).not.toHaveTextContent(EMP.id);
    // 21,000 x 8.33% = 1,749.30 (server formula, half-up on paise)
    expect(dialog).toHaveTextContent("₹1,749.30");

    fireEvent.click(screen.getByText("Compute bonus"));
    await waitFor(() => expect(document.querySelector(".pill.good")).toHaveTextContent("Bonus computation of ₹1,749.30 submitted."));
    const post = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse(String((post![1] as RequestInit).body));
    expect(body).toEqual({ employeeId: EMP.id, fy: expect.stringMatching(/^\d{4}-\d{2}$/), basicMinor: 2100000, bonusPct: 8.33 });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "50000" } });
    // no HRMS basic could be read, so the server needs a reason for the typed basic
    fireEvent.change(await screen.findByLabelText(/^Reason for changing the basic/), { target: { value: "HRMS value unavailable" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    await screen.findByText("Compute this bonus?");
    fireEvent.click(screen.getByText("Compute bonus"));
    await waitFor(() => expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument());
  });

  // GAP-PAYROLL-BONUS-02
  it("prefills the basic from HRMS when an employee is picked, and says where it came from", async () => {
    withBasic("1850000");
    renderForm();
    await pickEmployee();
    await waitFor(() => expect((screen.getByLabelText(/^Basic Salary/) as HTMLInputElement).value).toBe("18500.00"));
    expect(screen.getByText(/Prefilled from the employee's current basic in HRMS \(₹18,500.00\)/)).toBeInTheDocument();
  });

  it("a changed basic needs a reason (no request until given), then posts it as overrideReason", async () => {
    const fetchSpy = withBasic("1850000");
    renderForm();
    await pickEmployee();
    await waitFor(() => expect((screen.getByLabelText(/^Basic Salary/) as HTMLInputElement).value).toBe("18500.00"));
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "20000" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    expect(await screen.findByText("Give a reason for changing the basic from the HRMS value.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Reason for changing the basic/), { target: { value: "arrears of the new pay level" } });
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute bonus"));
    await waitFor(() => expect(fetchSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toMatchObject({ basicMinor: 2000000, overrideReason: "arrears of the new pay level" });
  });

  it("an unchanged HRMS basic needs no reason and sends none", async () => {
    const fetchSpy = withBasic("1850000");
    renderForm();
    await pickEmployee();
    await waitFor(() => expect((screen.getByLabelText(/^Basic Salary/) as HTMLInputElement).value).toBe("18500.00"));
    fireEvent.click(screen.getByRole("button", { name: "Compute Bonus" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByText("Compute bonus"));
    await waitFor(() => expect(fetchSpy.mock.calls.some((c) => (c[1] as RequestInit | undefined)?.method === "POST")).toBe(true));
    const post = fetchSpy.mock.calls.find((c) => (c[1] as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).not.toHaveProperty("overrideReason");
  });

  it("with a configured wage ceiling the preview is computed on capped wages and the ceiling is shown", async () => {
    withBasic("1500000", { wageCeilingMinor: "700000", eligibilityCeilingMinor: null });
    renderForm();
    await pickEmployee();
    await waitFor(() => expect(screen.getByText(/computed on wages up to ₹7,000.00 a month/)).toBeInTheDocument());
    // 7,000 x 8.33% = 583.10 (not 15,000 x 8.33% = 1,249.50)
    expect(screen.getByText("₹583.10")).toBeInTheDocument();
  });

  it("a failed HRMS lookup leaves manual entry and says so", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 502 }));
    renderForm();
    await pickEmployee();
    expect(await screen.findByText("Could not read the employee's basic from HRMS. Enter it manually.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Basic Salary/), { target: { value: "21000" } });
    expect((screen.getByLabelText(/^Basic Salary/) as HTMLInputElement).value).toBe("21000");
    // with no HRMS basic to compare against the server requires a reason
    expect(screen.getByLabelText(/^Reason for changing the basic/)).toBeInTheDocument();
  });
});
