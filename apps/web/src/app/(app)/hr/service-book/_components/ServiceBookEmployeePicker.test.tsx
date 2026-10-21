import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ServiceBookEmployeePicker } from "./ServiceBookEmployeePicker";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh: vi.fn() }) }));

function renderPicker(props: { selectedId?: string; selectedLabel?: string } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ServiceBookEmployeePicker {...props} />
    </NextIntlClientProvider>,
  );
}

const EMPLOYEES = [
  { id: "emp-7", employeeNo: "E-007", name: "Priya Nair", department: "Finance" },
  { id: "emp-9", employeeNo: "E-009", name: "Priyank Shah", department: "Estate" },
];

// GAP-HR-SERVICE-BOOK-04: the free-text box only filtered rows that had already loaded; this searches the
// whole directory and re-scopes the page via ?empId=.
describe("ServiceBookEmployeePicker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    push.mockClear();
  });

  it("searches the employee directory server-side by what is typed", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: EMPLOYEES }) }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    renderPicker();

    fireEvent.change(screen.getByRole("combobox", { name: "Show one employee's service book" }), { target: { value: "priya" } });

    expect(await screen.findByRole("option", { name: /Priya Nair/ })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/employees?q=priya&limit=20", expect.anything());
  });

  it("picking an employee navigates to ?empId=<id> so the page re-scopes server-side", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: EMPLOYEES }) }) as Response));
    renderPicker();

    fireEvent.change(screen.getByRole("combobox", { name: "Show one employee's service book" }), { target: { value: "priya" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Priyank Shah/ }));

    expect(push).toHaveBeenCalledWith("/hr/service-book?empId=emp-9");
  });

  it("url-encodes the picked id", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [{ id: "a b/c", name: "Odd Id" }] }) }) as Response));
    renderPicker();
    fireEvent.change(screen.getByRole("combobox", { name: "Show one employee's service book" }), { target: { value: "odd" } });
    fireEvent.mouseDown(await screen.findByRole("option", { name: /Odd Id/ }));
    expect(push).toHaveBeenCalledWith("/hr/service-book?empId=a%20b%2Fc");
  });

  it("shows the currently scoped employee's name without any lookup", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderPicker({ selectedId: "emp-7", selectedLabel: "Priya Nair" });
    expect(screen.getByRole("combobox", { name: "Show one employee's service book" })).toHaveValue("Priya Nair");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says so when the search matches no one (not a silent empty list)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: [] }) }) as Response));
    renderPicker();
    fireEvent.change(screen.getByRole("combobox", { name: "Show one employee's service book" }), { target: { value: "zzz" } });
    expect(await screen.findByText("No matching employees")).toBeInTheDocument();
  });
});
