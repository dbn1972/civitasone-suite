import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { EditEmployeeForm } from "./EditEmployeeForm";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

const EMPLOYEE = { id: "e1", employeeId: "EMP001", department: "IT", designation: "Assistant", status: "active", phone: "9876543210", email: "old@example.gov.in", reportingTo: "" };

function renderForm(employee: Record<string, unknown> = EMPLOYEE, messages: Record<string, unknown> = enMessages) {
  render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {/* @ts-expect-error minimal fixture, not the full EmployeeDetail type */}
      <EditEmployeeForm employee={employee} />
    </NextIntlClientProvider>,
  );
}

describe("EditEmployeeForm work state (professional tax)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows an optional state select, empty by default, with the state list", () => {
    renderForm();
    const sel = screen.getByLabelText("State of employment (for professional tax)") as HTMLSelectElement;
    expect(sel).toHaveValue("");
    expect(Array.from(sel.options).some((o) => o.value === "MH")).toBe(true);
    expect(Array.from(sel.options).some((o) => o.value === "ZZ")).toBe(false);
  });

  it("is seeded from the record and a change is sent as workStateCode", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "e1" }), { status: 202 }));
    renderForm({ ...EMPLOYEE, workStateCode: "KA" });
    const sel = screen.getByLabelText("State of employment (for professional tax)") as HTMLSelectElement;
    expect(sel).toHaveValue("KA");
    fireEvent.change(sel, { target: { value: "MH" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ workStateCode: "MH" });
  });

  it("an unchanged state is not sent", async () => {
    renderForm({ ...EMPLOYEE, workStateCode: "KA" });
    fireEvent.change(screen.getByLabelText(/mobile/i), { target: { value: "9123456780" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).not.toHaveProperty("workStateCode");
  });

  it("has the Hindi label", () => {
    renderForm(EMPLOYEE, hiMessages);
    expect(screen.getByLabelText("रोजगार का राज्य (व्यावसायिक कर के लिए)")).toBeInTheDocument();
  });
});
