import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { AllocationForm } from "./AllocationForm";

const EMP = "11111111-1111-4111-8111-111111111111";
const P1 = { projectId: "22222222-2222-4222-8222-222222222222", code: "DIGILOCKER", name: "DigiLocker", costCenterId: "33333333-3333-4333-8333-333333333333" };
const P2 = { projectId: "44444444-4444-4444-8444-444444444444", code: "MYGOV", name: "MyGov", costCenterId: null };
const CC = { id: "55555555-5555-4555-8555-555555555555", code: "CC-CORP", name: "Corporate" };

function stubFetch(post: Response) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/hrms/employees")) return Promise.resolve(new Response(JSON.stringify({ data: [{ id: EMP, name: "Asha Rao", employeeNo: "C-101" }] }), { status: 200 }));
    return Promise.resolve(post);
  });
}
function renderForm(locale: "en" | "hi" = "en", enabled = true) {
  render(
    <NextIntlClientProvider locale={locale} messages={locale === "en" ? enMessages : hiMessages}>
      <AllocationForm projects={[P1, P2]} costCenters={[CC]} enabled={enabled} />
    </NextIntlClientProvider>,
  );
}
async function pickEmployee() {
  const combo = screen.getByRole("combobox", { name: /employee/i });
  fireEvent.focus(combo);
  fireEvent.change(combo, { target: { value: "Asha" } });
  fireEvent.mouseDown(await screen.findByText(/Asha Rao/));
}

describe("AllocationForm", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("has a visible label on every control and announces what is required", () => {
    renderForm();
    for (const name of [/^Employee/, /^Charge to/, /^Project/, /Share of the employee/, /^Effective from/, /^Effective to/, /^Note/]) {
      expect(screen.getByLabelText(name)).toBeInTheDocument();
    }
  });

  it("blocks an empty submit with an announced error and sends nothing", () => {
    const f = stubFetch(new Response("{}", { status: 202 }));
    renderForm();
    fireEvent.click(screen.getByRole("button", { name: "Request allocation" }));
    expect(screen.getAllByRole("alert").some((a) => a.textContent?.includes("Search for and select an employee."))).toBe(true);
    expect(f.mock.calls.some(([u]) => String(u).includes("project-costing"))).toBe(false);
  });

  it("refuses a project that has no cost centre yet", async () => {
    stubFetch(new Response("{}", { status: 202 }));
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Project/), { target: { value: P2.projectId } });
    fireEvent.change(screen.getByLabelText(/Share of the employee/), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Request allocation" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(new RegExp("no cost centre yet".replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("rejects a share over 100 and an end date before the start", async () => {
    stubFetch(new Response("{}", { status: 202 }));
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Project/), { target: { value: P1.projectId } });
    fireEvent.change(screen.getByLabelText(/Share of the employee/), { target: { value: "101" } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2026-04-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Request allocation" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/above 0 and up to 100/);
    fireEvent.change(screen.getByLabelText(/Share of the employee/), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/^Effective to/), { target: { value: "2026-04-09" } });
    fireEvent.click(screen.getByRole("button", { name: "Request allocation" }));
    expect(screen.getAllByRole("alert").map((a) => a.textContent).join(" ")).toMatch(/must not be before the start/);
  });

  it("confirms, then POSTs the project allocation with the project's own cost centre", async () => {
    const f = stubFetch(new Response(JSON.stringify({ id: "a1", status: "accepted" }), { status: 202 }));
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Project/), { target: { value: P1.projectId } });
    fireEvent.change(screen.getByLabelText(/Share of the employee/), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Request allocation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Request" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const post = f.mock.calls.find(([u]) => String(u).includes("project-costing/allocations"))!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      employeeId: EMP, targetType: "project", projectId: P1.projectId, costCenterId: P1.costCenterId, splitPct: 60, effectiveFrom: "2026-04-01",
    });
  });

  it("maps the server's over-100 refusal to a plain message", async () => {
    stubFetch(new Response(JSON.stringify({ code: "ALLOCATION_EXCEEDS_100", message: "x" }), { status: 422 }));
    renderForm();
    await pickEmployee();
    fireEvent.change(screen.getByLabelText(/^Charge to/), { target: { value: "cost_center" } });
    fireEvent.change(screen.getByLabelText(/^Cost centre/), { target: { value: CC.id } });
    fireEvent.change(screen.getByLabelText(/Share of the employee/), { target: { value: "70" } });
    fireEvent.change(screen.getByLabelText(/^Effective from/), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Request allocation" }));
    fireEvent.click(await screen.findByRole("button", { name: "Request" }));
    expect(await screen.findAllByText(/above 100% on at least one day/)).not.toHaveLength(0);
  });

  it("explains and disables the form while project costing is off", () => {
    renderForm("en", false);
    expect(screen.getByText(/not switched on/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request allocation" })).toBeDisabled();
  });

  it("renders in Hindi", () => {
    renderForm("hi");
    expect(screen.getByRole("button", { name: "आवंटन का अनुरोध करें" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /कर्मचारी/ })).toBeInTheDocument();
  });
});
