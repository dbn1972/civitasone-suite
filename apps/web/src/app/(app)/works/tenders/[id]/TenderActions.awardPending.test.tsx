/**
 * Owner decision D4c #45: the award is a queued command (202). The page shows "Award pending" (not a success) until the
 * award really exists, then confirms it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@/test-utils/intl-render";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { TenderActions, type TenderQuotationOption } from "./TenderActions";

const TENDER_ID = "tttttttt-1111-2222-3333-444444444444";
const CONTRACTOR_ID = "cccccccc-1111-2222-3333-444444444444";
const quotations: TenderQuotationOption[] = [
  { id: "q1", contractorId: CONTRACTOR_ID, contractorName: "ACME Builders", quotedAmountMinor: "5000000", method: "item_rate", status: "submitted" },
];
const renderWithToast = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);

/** award POST -> 202; the tender award read answers per `arrivesAfter` polls. */
function mockFetch(arrivesAfter: number) {
  let polls = 0;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith(`/tenders/${TENDER_ID}/award`) && (init?.method ?? "GET") === "GET") {
      polls += 1;
      return new Response(JSON.stringify({ data: polls > arrivesAfter ? { id: "award-1", status: "draft" } : null }), { status: 200 });
    }
    if (url.endsWith("/tenders/award")) return new Response(JSON.stringify({ id: "award-1", status: "accepted" }), { status: 202 });
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  });
}
async function submitAward() {
  fireEvent.click(screen.getByRole("button", { name: "+ Create Award" }));
  fireEvent.change(screen.getByLabelText(/Award this quotation/i), { target: { value: "q1" } });
  await waitFor(() => expect((screen.getByLabelText(/Accepted Amount/i) as HTMLInputElement).value).toBe("50000.00"));
  fireEvent.click(screen.getByRole("button", { name: "Create Award" }));
}

describe("TenderActions: award pending until the queued result arrives (D4c #45)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("shows Award pending after the 202, takes the Create Award control away, and asks the server for the result", async () => {
    const spy = mockFetch(99);
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} quotations={quotations} awardPollDelayMs={5} />);
    await submitAward();
    expect(await screen.findByText(/award pending/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "+ Create Award" })).toBeNull();
    // no success claim yet
    expect(screen.queryByText(/award recorded/i)).toBeNull();
    await waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).endsWith(`/tenders/${TENDER_ID}/award`))).toBe(true));
  });

  it("confirms once the award exists, and refreshes the page data", async () => {
    mockFetch(1);
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} quotations={quotations} awardPollDelayMs={5} />);
    await submitAward();
    expect((await screen.findAllByText(/award recorded/i, undefined, { timeout: 4000 })).length).toBeGreaterThan(0);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.queryByText(/award pending/i)).toBeNull();
  });

  it("does not show Award pending when the award POST itself fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) =>
      String(input).endsWith("/tenders/award") ? new Response("{}", { status: 500 }) : new Response(JSON.stringify({ data: [] }), { status: 200 }));
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} quotations={quotations} awardPollDelayMs={5} />);
    await submitAward();
    await waitFor(() => expect(screen.getByText(/couldn.t save/i)).toBeInTheDocument());
    expect(screen.queryByText(/award pending/i)).toBeNull();
  });
});
