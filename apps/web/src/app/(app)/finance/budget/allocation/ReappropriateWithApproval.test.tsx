import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

import { ReappropriateWithApproval } from "./ReappropriateWithApproval";

function render(ui: React.ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const BUDGETS = [
  { id: "11111111-1111-4111-8111-111111111111", label: "3054 Roads · FY 2026-27", availableMinor: "500000000" },
  { id: "22222222-2222-4222-8222-222222222222", label: "4202 Schools · FY 2026-27", availableMinor: "0" },
];
const EMPLOYEES = [
  { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", employeeNo: "E-001", name: "Asha Rao", department: "Finance" },
  { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", employeeNo: "E-002", name: "Ben Iyer", department: "Finance" },
];
const ME = { id: "99999999-9999-4999-8999-999999999999", fullName: "Meera Self", employeeNo: "E-009" };

type Calls = { url: string; init: RequestInit }[];
function mockApi(opts: { submit?: Response; raise?: Response } = {}): Calls {
  const calls: Calls = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : (input as Request).url;
    calls.push({ url, init: (init ?? {}) as RequestInit });
    if (url.includes("/hrms/me/profile")) return new Response(JSON.stringify(ME), { status: 200 });
    if (url.includes("/hrms/employees")) return new Response(JSON.stringify({ data: EMPLOYEES }), { status: 200 });
    if (url.includes("/reappropriations/") && url.endsWith("/submit-approval")) return opts.submit ?? new Response(JSON.stringify({ data: { id: "x", status: "accepted" } }), { status: 202 });
    if (url.includes("/estab/files/from-module")) return opts.raise ?? new Response(JSON.stringify({ id: "f1", fileNo: "EO/FIN/2026/101" }), { status: 201 });
    return new Response(null, { status: 404 });
  });
  return calls;
}

async function fillForm(over: { amount?: string } = {}) {
  fireEvent.click(screen.getByRole("button", { name: /Re-appropriation with approval/ }));
  fireEvent.change(await screen.findByLabelText("Move money from (savings head)"), { target: { value: BUDGETS[0]!.id } });
  fireEvent.change(screen.getByLabelText("Move money to"), { target: { value: BUDGETS[1]!.id } });
  fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: over.amount ?? "1,000.50" } });
  fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Savings on road works" } });
  fireEvent.change(screen.getByLabelText("Justification note"), { target: { value: "Please approve the transfer" } });
  fireEvent.change(screen.getByLabelText("Forward to officer"), { target: { value: "Ben" } });
  fireEvent.mouseDown(await screen.findByText("Ben Iyer (E-002)"));
  await screen.findByDisplayValue("Ben Iyer (E-002)");
}

describe("ReappropriateWithApproval (GAP-FINANCE-BUDGET-ALLOCATION-03)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("budgets are chosen from the provided list (no uuid typing) and the initiator defaults to the signed-in user", async () => {
    mockApi();
    render(<ReappropriateWithApproval allocations={BUDGETS} />);
    fireEvent.click(screen.getByRole("button", { name: /Re-appropriation with approval/ }));
    const from = (await screen.findByLabelText("Move money from (savings head)")) as HTMLSelectElement;
    expect(within(from).getByRole("option", { name: /3054 Roads · FY 2026-27 — available/ })).toBeInTheDocument();
    expect(await screen.findByDisplayValue("Meera Self (E-009)")).toBeInTheDocument();
    // the target list never offers the source budget
    fireEvent.change(from, { target: { value: BUDGETS[0]!.id } });
    const to = screen.getByLabelText("Move money to") as HTMLSelectElement;
    expect(within(to).queryByRole("option", { name: /3054 Roads/ })).not.toBeInTheDocument();
  });

  it("submits fromBudgetId / toBudgetId / exact paise string, then raises the eFile with the SAME request id; success names the officers", async () => {
    const calls = mockApi();
    render(<ReappropriateWithApproval allocations={BUDGETS} />);
    await fillForm();
    await screen.findByDisplayValue("Meera Self (E-009)");
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("₹1,000.50");
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit to eOffice" }));

    const done = await screen.findByText(/Re-appropriation raised for approval \(eFile EO\/FIN\/2026\/101\)/);
    expect(done).toHaveTextContent("Initiated by Meera Self (E-009), forwarded to Ben Iyer (E-002)");
    const sub = calls.find((c) => c.url.endsWith("/submit-approval"))!;
    const reqId = sub.url.match(/reappropriations\/([0-9a-f-]{36})\/submit-approval/)![1];
    expect(JSON.parse(sub.init.body as string)).toEqual({
      fromBudgetId: BUDGETS[0]!.id, toBudgetId: BUDGETS[1]!.id, amountMinor: "100050", reason: "Savings on road works",
    });
    const raise = calls.find((c) => c.url.includes("/estab/files/from-module"))!;
    const body = JSON.parse(raise.init.body as string);
    expect(body).toMatchObject({ refType: "finance_reappropriation", refId: reqId, initiatedBy: ME.id, currentWith: EMPLOYEES[1]!.id });
    expect(body.context).toEqual({ fromBudgetId: BUDGETS[0]!.id, toBudgetId: BUDGETS[1]!.id, amountMinor: "100050" });
  });

  it("validates before anything is sent: a bad amount and an amount above the source balance", async () => {
    const calls = mockApi();
    render(<ReappropriateWithApproval allocations={BUDGETS} />);
    await fillForm({ amount: "abc" });
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    expect(await screen.findByText(/Enter an amount in rupees greater than 0/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Amount (₹)"), { target: { value: "5000001" } }); // available is ₹50,00,000.00
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    expect(await screen.findByText(/more than the available balance/)).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.url.includes("submit-approval") || c.url.includes("from-module"))).toHaveLength(0);
  });

  it("a rejected submit shows a plain message (never the response body) and the eFile is not raised", async () => {
    const calls = mockApi({ submit: new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "stack at x" }), { status: 400 }) });
    render(<ReappropriateWithApproval allocations={BUDGETS} />);
    await fillForm();
    await screen.findByDisplayValue("Meera Self (E-009)");
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Submit to eOffice" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Some details weren't accepted\. Check what you entered and try again\./);
    expect(alert.textContent).not.toMatch(/VALIDATION_FAILED|stack|400/);
    expect(calls.some((c) => c.url.includes("from-module"))).toBe(false);
  });

  it("if the eFile step fails after the request was saved, a retry repeats only the eFile step with the same id", async () => {
    const calls = mockApi({ raise: new Response("boom", { status: 500 }) });
    render(<ReappropriateWithApproval allocations={BUDGETS} />);
    await fillForm();
    await screen.findByDisplayValue("Meera Self (E-009)");
    fireEvent.click(screen.getByRole("button", { name: "Review and submit" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Submit to eOffice" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/saved but the eFile could not be raised/i);
    // retry
    vi.restoreAllMocks();
    const retry = mockApi();
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Submit to eOffice" }));
    await screen.findByText(/Re-appropriation raised for approval/);
    expect(retry.some((c) => c.url.endsWith("/submit-approval"))).toBe(false);
    const firstId = calls.find((c) => c.url.endsWith("/submit-approval"))!.url.match(/reappropriations\/([0-9a-f-]{36})\//)![1];
    const retryBody = JSON.parse(retry.find((c) => c.url.includes("from-module"))!.init.body as string);
    expect(retryBody.refId).toBe(firstId);
  });
});
