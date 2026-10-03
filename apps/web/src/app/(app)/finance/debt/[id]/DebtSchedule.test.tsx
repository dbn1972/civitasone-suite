import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { FinanceDebtEmi } from "@civitasone/types";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { DebtSchedule, nextDueIndex } from "./DebtSchedule";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const emi = (no: number, over: Partial<FinanceDebtEmi> = {}): FinanceDebtEmi => ({
  installmentNo: no, dueDate: `2031-0${no + 4}-30`, principalMinor: "8000000", interestMinor: "700000", totalMinor: "8700000",
  status: "due", paidOn: null, paymentRef: null, ...over,
});

describe("nextDueIndex", () => {
  it("is the first unpaid instalment, or -1 when all are paid", () => {
    expect(nextDueIndex([{ status: "paid" }, { status: "due" }, { status: "due" }])).toBe(1);
    expect(nextDueIndex([{ status: "paid" }])).toBe(-1);
  });
});

describe("DebtSchedule", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("lists every instalment with exact money; paid ones show the date and reference, due ones offer Record payment", () => {
    render(<DebtSchedule debtId="d1" canRecordPayment schedule={[emi(1, { status: "paid", paidOn: "2031-05-30", paymentRef: "UTR123", glStatus: "posted" }), emi(2)]} />);
    expect(screen.getByText("Posted")).toBeInTheDocument();
    expect(screen.getAllByText("₹87,000.00")).toHaveLength(2);
    expect(screen.getByText("Paid")).toBeInTheDocument();
    expect(screen.getByText(/30 May 2031 · UTR123/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Record payment" })).toHaveLength(1);
  });

  it("a viewer who cannot record payments sees no button", () => {
    render(<DebtSchedule debtId="d1" canRecordPayment={false} schedule={[emi(1)]} />);
    expect(screen.queryByRole("button", { name: "Record payment" })).not.toBeInTheDocument();
  });

  it("confirms first, then POSTs the optional reference to the pay route and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ status: "accepted" }), { status: 202 }));
    render(<DebtSchedule debtId="d1" canRecordPayment schedule={[emi(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    expect(await screen.findByText("Record payment of instalment 1?")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Payment reference (optional)"), { target: { value: "UTR999" } });
    fireEvent.click((await screen.findAllByRole("button", { name: "Record payment" })).at(-1)!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock.mock.calls[0]![0]).toBe("/api/proxy/v1/finance/debt/d1/emi/1/pay");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ paymentRef: "UTR999" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("an already-paid refusal is plain words, never the code", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "EMI_ALREADY_PAID" }), { status: 409 }));
    render(<DebtSchedule debtId="d1" canRecordPayment schedule={[emi(1)]} />);
    fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Record payment" })).at(-1)!);
    const msg = await screen.findByText(/already recorded as paid/);
    expect(msg.textContent).not.toMatch(/EMI_ALREADY_PAID|409/);
  });

  it("an empty schedule is an explicit empty state", () => {
    render(<DebtSchedule debtId="d1" canRecordPayment schedule={[]} />);
    expect(screen.getByText("No repayment schedule")).toBeInTheDocument();
  });

  it("instalments are recorded in order: only the first one still due has a button", () => {
    render(<DebtSchedule debtId="d1" canRecordPayment schedule={[emi(1, { status: "paid", paidOn: "2031-05-30", glStatus: "pending" }), emi(2), emi(3)]} />);
    expect(screen.getAllByRole("button", { name: "Record payment" })).toHaveLength(1);
    expect(screen.getByText("Awaiting posting")).toBeInTheDocument();
  });

  it("server refusals read in plain words: out of order, GL heads not set, bad date", async () => {
    for (const [code, re] of [
      ["EMI_OUT_OF_ORDER", /Record the earlier instalment first/],
      ["GL_HEADS_NOT_CONFIGURED", /GL heads are not set up/],
      ["EMI_PAID_ON_FUTURE", /must not be in the future/],
    ] as const) {
      vi.restoreAllMocks();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code }), { status: 409 }));
      const { unmount } = render(<DebtSchedule debtId="d1" canRecordPayment schedule={[emi(1)]} />);
      fireEvent.click(screen.getByRole("button", { name: "Record payment" }));
      fireEvent.click((await screen.findAllByRole("button", { name: "Record payment" })).at(-1)!);
      const msg = await screen.findByText(re);
      expect(msg.textContent).not.toMatch(/EMI_|GL_HEADS|409/);
      unmount();
    }
  });
});
