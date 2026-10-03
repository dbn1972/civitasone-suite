import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
import { OutsourcedRegister } from "./OutsourcedRegister";

const ROW = { id: "c1", vendorName: "SecureGuard", serviceCategory: "Security", contractRef: "—", headcount: 12, period: "01 Jan 2026 – 31 Dec 2026", contractValue: "₹1.00", status: "active", canTerminate: true };

function ui() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OutsourcedRegister rows={[ROW]} canManage cardTitle="Vendor Contracts" emptyTitle="none" emptyMessage="none" />
    </NextIntlClientProvider>,
  );
}
afterEach(() => { vi.unstubAllGlobals(); refresh.mockReset(); });

describe("OutsourcedRegister (GAP-HR-OUTSOURCED-01)", () => {
  it("submits a new contract with the value converted rupees -> paise string, then says submitted", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "x", status: "accepted" }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    ui();
    fireEvent.click(screen.getByRole("button", { name: /add contract/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/vendor name/i), { target: { value: " Clean Co " } });
    fireEvent.change(within(dialog).getByLabelText(/service category/i), { target: { value: "Housekeeping" } });
    fireEvent.change(within(dialog).getByLabelText(/headcount supplied/i), { target: { value: "30" } });
    fireEvent.change(within(dialog).getByLabelText(/contract start/i), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText(/contract end/i), { target: { value: "2027-03-31" } });
    fireEvent.change(within(dialog).getByLabelText(/contract value/i), { target: { value: "12,34,567.50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save contract/i }));

    await waitFor(() => expect(screen.getByText(/change submitted/i)).toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/outsourced");
    expect(JSON.parse(String(init.body))).toMatchObject({ vendorName: "Clean Co", headcount: 30, contractValueMinor: "123456750" });
    expect(refresh).toHaveBeenCalled();
  });

  it("blocks an end date before the start date client-side without calling the API", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    ui();
    fireEvent.click(screen.getByRole("button", { name: /add contract/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/vendor name/i), { target: { value: "V" } });
    fireEvent.change(within(dialog).getByLabelText(/service category/i), { target: { value: "S" } });
    fireEvent.change(within(dialog).getByLabelText(/headcount supplied/i), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText(/contract start/i), { target: { value: "2026-05-01" } });
    fireEvent.change(within(dialog).getByLabelText(/contract end/i), { target: { value: "2026-04-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /save contract/i }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/end date cannot be before/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("terminating requires a reason and PATCHes status=terminated with it", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    ui();
    fireEvent.click(screen.getByRole("button", { name: /^terminate$/i }));
    const dlg = await screen.findByRole("alertdialog");
    fireEvent.change(within(dlg).getByLabelText(/reason for terminating/i), { target: { value: "Vendor breach" } });
    fireEvent.click(within(dlg).getByRole("button", { name: /^terminate$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/hrms/outsourced/c1");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "terminated", remarks: "Vendor breach" });
  });
});
