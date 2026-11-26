import { describe, it, expect, vi, afterEach } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import enMessages from "@/messages/en.json";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
// A deterministic employee picker: choosing "Meena Iyer" selects a fixed id.
vi.mock("@/app/_components/EmployeePicker", () => ({
  EmployeePicker: ({ onChange }: { onChange: (id: string | null, o: { value: string; label: string } | null) => void }) => (
    <button type="button" onClick={() => onChange("11111111-1111-4111-8111-111111111111", { value: "11111111-1111-4111-8111-111111111111", label: "Meena Iyer" })}>pick officer</button>
  ),
}));

import { NewDeputationForm, rupeesToPaise } from "./NewDeputationForm";

const show = () => render(<NextIntlClientProvider locale="en" messages={enMessages}><NewDeputationForm /></NextIntlClientProvider>);

function fill(): void {
  fireEvent.click(screen.getByRole("button", { name: "pick officer" }));
  fireEvent.change(screen.getByLabelText(/Parent cadre/), { target: { value: "State Civil Service (Revenue)" } });
  fireEvent.change(screen.getByLabelText(/Borrowing organisation/), { target: { value: "National Informatics Centre (NIC)" } });
  fireEvent.change(screen.getByLabelText(/Deputation from/), { target: { value: "2026-12-01" } });
  fireEvent.change(screen.getByLabelText(/Deputation until/), { target: { value: "2027-11-30" } });
  fireEvent.change(screen.getByLabelText(/Deputation allowance/), { target: { value: "5000.50" } });
}

describe("rupeesToPaise", () => {
  it("converts to integer paise without float error", () => {
    expect(rupeesToPaise("")).toBe(0);
    expect(rupeesToPaise("5000")).toBe(500000);
    expect(rupeesToPaise("5000.5")).toBe(500050);
    expect(rupeesToPaise("0.07")).toBe(7);
    expect(rupeesToPaise("19.99")).toBe(1999);
  });
  it("refuses negatives, junk and more than two decimals", () => {
    for (const bad of ["-1", "abc", "1.234", "1,000", "1e5"]) expect(rupeesToPaise(bad)).toBeNull();
  });
});

describe("NewDeputationForm (GAP-HR-DEPUTATION-02)", () => {
  afterEach(() => { vi.unstubAllGlobals(); push.mockClear(); refresh.mockClear(); });

  it("validates before anything is sent, and shows no confirm dialog while the form is invalid", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    show();
    fireEvent.click(screen.getByRole("button", { name: "Review and depute" }));
    expect(screen.getByText("Choose the officer.")).toBeInTheDocument();
    expect(screen.getByText("Enter the parent cadre.")).toBeInTheDocument();
    expect(screen.getByText("Enter the end date.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an end date on or before the start date is refused", () => {
    show();
    fill();
    fireEvent.change(screen.getByLabelText(/Deputation until/), { target: { value: "2026-12-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Review and depute" }));
    expect(screen.getByText("The end date must be after the start date.")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("asks for confirmation naming the officer, then POSTs to the employee's deputations route with allowance in paise", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201, text: async () => "{}" }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    show();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Review and depute" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Depute Meena Iyer?");
    expect(dialog).toHaveTextContent("National Informatics Centre (NIC)");
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Depute officer" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/employees/11111111-1111-4111-8111-111111111111/deputations");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      parentCadre: "State Civil Service (Revenue)", borrowingDepartment: "National Informatics Centre (NIC)",
      deputationAllowanceMinor: 500050, tenureFrom: "2026-12-01", tenureTo: "2027-11-30",
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/hr/deputation"));
  });

  it("a 409 (already deputed) is explained, not shown as a generic failure", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, text: async () => JSON.stringify({ code: "ALREADY_DEPUTED" }) }) as Response));
    show();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Review and depute" }));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: "Depute officer" }));
    expect(await screen.findByText(/already has an active deputation/)).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
