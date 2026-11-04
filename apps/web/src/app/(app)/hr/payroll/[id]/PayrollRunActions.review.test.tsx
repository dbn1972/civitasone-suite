/**
 * T-STAT review of PR #2449, SHOULD-FIX 7: the approve dialog is usable when
 * the server asks for a review. On 409 ZERO_BASIC_SLIPS / ARREARS_REVIEW_REQUIRED
 * it loads GET .../approval-review, lists the Rs 0-basic slips (exclude each)
 * and the arrears above the threshold (acknowledge each), takes one review
 * note, and re-sends the approval with zeroBasicExclusions and
 * arrearsAcknowledgements.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/_components/ds/Toast", () => ({ useToast: () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }) }));

import { PayrollRunActions } from "./PayrollRunActions";

const PROPS = { runId: "r1", status: "processing", employeeCount: 3, grossMinor: "16000000", netMinor: "16000000", payPeriod: "2026-09", canAdminister: true };
const REVIEW = {
  runId: "r1",
  zeroBasic: [{ employeeId: "11111111-1111-4111-8111-111111111111", employeeNo: "Z-1" }],
  arrears: {
    totalMinor: "7000000", thresholdBps: 10000,
    employees: [
      { employeeId: "22222222-2222-4222-8222-222222222222", employeeNo: "A-BIG", arrearsMinor: "6000000", regularGrossMinor: "5000000", requiresReview: true },
      { employeeId: "33333333-3333-4333-8333-333333333333", employeeNo: "A-SMALL", arrearsMinor: "1000000", regularGrossMinor: "5000000", requiresReview: false },
    ],
  },
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("PayrollRunActions — approval review (Rs 0-basic exclusions, arrears acknowledgement)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  function open() {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PayrollRunActions {...PROPS} /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /approve run/i }));
  }

  it("after a 409 review response it lists the items, requires them, and re-sends with exclusions and acknowledgements", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ code: "ZERO_BASIC_SLIPS", message: "1 slip(s) in this run have no basic pay" }, 409))
      .mockResolvedValueOnce(json(REVIEW))
      .mockResolvedValueOnce(json({ id: "r1", status: "accepted", correlationId: "c" }, 202));
    open();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Reviewed and correct" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve run/i }));

    const exclude = await within(dialog).findByRole("checkbox", { name: /exclude Z-1 from this run/i });
    const ack = within(dialog).getByRole("checkbox", { name: /checked the arrears of .* for A-BIG/i });
    expect(within(dialog).queryByRole("checkbox", { name: /A-SMALL/ })).toBeNull();
    expect(fetchMock.mock.calls[1]![0]).toBe("/api/proxy/v1/payroll/runs/r1/approval-review");

    // Incomplete: nothing checked -> no request, a clear message.
    fireEvent.click(within(dialog).getByRole("button", { name: /approve run/i }));
    await waitFor(() => expect(dialog).toHaveTextContent(/exclude every slip with no basic pay/i));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    fireEvent.click(exclude);
    fireEvent.click(ack);
    fireEvent.change(within(dialog).getByLabelText(/review note/i), { target: { value: "HRMS basic missing; arrears checked" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve run/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(url).toBe("/api/proxy/v1/payroll/runs/r1/approve");
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      reason: "Reviewed and correct",
      zeroBasicExclusions: [{ employeeId: REVIEW.zeroBasic[0]!.employeeId, reason: "HRMS basic missing; arrears checked" }],
      arrearsAcknowledgements: [{ employeeId: REVIEW.arrears.employees[0]!.employeeId, reason: "HRMS basic missing; arrears checked" }],
    });
  });

  it("409 EPS_ELIGIBILITY_UNRECORDED (tenant policy block) lists the EPF members whose EPS eligibility is not recorded (PR #2458 delta review)", async () => {
    fetchMock
      .mockResolvedValueOnce(json({ code: "EPS_ELIGIBILITY_UNRECORDED", message: "raw" }, 409))
      .mockResolvedValueOnce(json({ runId: "r1", zeroBasic: [], arrears: { totalMinor: "0", thresholdBps: 10000, employees: [] },
        epsUnrecorded: { policy: "block", employees: [{ employeeId: "e1", employeeNo: "UATG1-25595" }, { employeeId: "e2", employeeNo: "UATG1-37007" }] } }));
    open();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Reviewed and correct" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve run/i }));
    const box = (await within(dialog).findByText(enMessages.payroll.runApproval.epsUnrecordedHeading)).closest("div")!;
    expect(box).toHaveAttribute("role", "note");
    expect(box).toHaveTextContent(enMessages.payroll.runApproval.epsUnrecordedBlock);
    expect(box).toHaveTextContent("UATG1-25595, UATG1-37007");
    expect(box.textContent).not.toContain("EPS_ELIGIBILITY_UNRECORDED");
  });

  it("a plain approval sends only the remarks (no review fields)", async () => {
    fetchMock.mockResolvedValueOnce(json({ id: "r1", status: "accepted", correlationId: "c" }, 202));
    open();
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Reviewed and correct" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /approve run/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string)).toEqual({ reason: "Reviewed and correct" });
  });
});
