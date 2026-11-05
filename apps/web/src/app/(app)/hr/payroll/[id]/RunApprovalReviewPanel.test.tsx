/**
 * T-STAT review of PR #2449, SHOULD-FIX 4: the run summary shows the arrears
 * the run pays (total and per employee, flagging those that need an
 * acknowledgement) and the Rs 0-basic slips, before anyone approves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { RunApprovalReviewPanel } from "./RunApprovalReviewPanel";

const REVIEW = {
  runId: "r1",
  zeroBasic: [{ employeeId: "z", employeeNo: "Z-1" }],
  arrears: {
    totalMinor: "7000000", thresholdBps: 10000,
    employees: [
      { employeeId: "a", employeeNo: "A-BIG", arrearsMinor: "6000000", regularGrossMinor: "5000000", requiresReview: true },
      { employeeId: "b", employeeNo: "A-SMALL", arrearsMinor: "1000000", regularGrossMinor: "5000000", requiresReview: false },
    ],
  },
};

describe("RunApprovalReviewPanel", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the arrears total, the per-employee list and the Rs 0-basic count", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(REVIEW), { status: 200, headers: { "content-type": "application/json" } }));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RunApprovalReviewPanel runId="r1" /></NextIntlClientProvider>);
    const region = await screen.findByRole("region", { name: /arrears in this run/i });
    expect(region).toHaveTextContent(/2 employees are paid arrears totalling ₹70,000\.00/);
    expect(region).toHaveTextContent(/1 needs an acknowledgement/);
    const rows = within(region).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual(expect.arrayContaining([expect.stringMatching(/A-BIG.*₹60,000\.00.*Needs acknowledgement/), expect.stringMatching(/A-SMALL.*₹10,000\.00.*Within threshold/)]));
    expect(region).toHaveTextContent(/1 slip has no basic pay/);
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/payroll/runs/r1/approval-review");
  });

  it("UAT T-PERIOD D-02b: flags the slips that pay nothing (net Rs 0 or deductions above gross)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      runId: "r1", zeroBasic: [], arrears: { totalMinor: "0", thresholdBps: 10000, employees: [] },
      nonPositiveNet: [{ employeeId: "n", employeeNo: "TP-EMP-01", grossMinor: "23142800", totalDeductionsMinor: "29029700", netPayMinor: "0", tdsMinor: "27084700" }],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RunApprovalReviewPanel runId="r1" /></NextIntlClientProvider>);
    const region = await screen.findByRole("region", { name: /review before approval/i });
    expect(region).toHaveTextContent(/1 slip pays nothing/);
  });

  it("PR #2459 review B2: lists the TDS items (presumed months, unrecoverable shortfall) for the approver", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      runId: "r1", zeroBasic: [], arrears: { totalMinor: "0", thresholdBps: 10000, employees: [] }, nonPositiveNet: [],
      tds: [
        { employeeId: "a", employeeNo: "TP-EMP-01", kind: "presumed_months", amountMinor: "0", presumedMonths: 9, finalMonth: false, requiresAck: true, message: "" },
        { employeeId: "b", employeeNo: "TP-EMP-02", kind: "shortfall", amountMinor: "500000", presumedMonths: 0, finalMonth: true, requiresAck: true, message: "" },
        { employeeId: "c", employeeNo: "TP-EMP-03", kind: "excess", amountMinor: "6771100", presumedMonths: 0, finalMonth: false, requiresAck: false, message: "" },
      ],
    }), { status: 200, headers: { "content-type": "application/json" } }));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><RunApprovalReviewPanel runId="r1" /></NextIntlClientProvider>);
    const region = await screen.findByRole("region", { name: /review before approval/i });
    expect(region).toHaveTextContent(/TP-EMP-01: 9 earlier month\(s\) with no slip and no opening YTD/);
    expect(region).toHaveTextContent(/TP-EMP-02: ₹5,000\.00 of TDS not deducted this month \(deduction limit, Code on Wages 2019 s\.18\(2\)\)\. This cannot be recovered through payroll this FY -- collect separately or adjust before Form 16\./);
    expect(region).toHaveTextContent(/TP-EMP-03: TDS deducted this year exceeds the estimated tax by ₹67,711\.00/);
  });

  it("renders nothing when there are no arrears and no Rs 0-basic slips, or the read fails", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ runId: "r1", zeroBasic: [], arrears: { totalMinor: "0", thresholdBps: 10000, employees: [] } }), { status: 200 }));
    const { container, unmount } = render(<NextIntlClientProvider locale="en" messages={enMessages}><RunApprovalReviewPanel runId="r1" /></NextIntlClientProvider>);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe("");
    unmount();
    fetchMock.mockRejectedValueOnce(new Error("network"));
    const second = render(<NextIntlClientProvider locale="en" messages={enMessages}><RunApprovalReviewPanel runId="r1" /></NextIntlClientProvider>);
    await new Promise((r) => setTimeout(r, 0));
    expect(second.container.textContent).toBe("");
  });
});
