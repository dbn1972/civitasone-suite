import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within, act } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { TenderActions, type TenderQuotationOption } from "./TenderActions";

const TENDER_ID = "tttttttt-1111-2222-3333-444444444444";
const AWARD_ID = "awardawa-5555-6666-7777-888888888888";
const CONTRACTOR_ID = "cccccccc-1111-2222-3333-444444444444";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

/** Mock fetch: contractor search returns a registered contractor; award-read
 *  returns a status; actions return 202. */
function mockFetch(opts: { awardStatus?: string; actionStatus?: number } = {}) {
  const { awardStatus, actionStatus = 202 } = opts;
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/works/contractors")) {
      return new Response(JSON.stringify({ data: [{ id: CONTRACTOR_ID, name: "ACME Builders", registrationNo: "REG-1" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.match(/\/award\/[^/]+$/)) {
      return new Response(JSON.stringify({ data: { id: AWARD_ID, status: awardStatus ?? "draft" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ id: AWARD_ID, status: "accepted" }), { status: actionStatus });
  });
}

describe("TenderActions — DETAIL-02 role gating + ordered finalize", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("does not render a DO finalize button when the user lacks the DO role", () => {
    mockFetch({ awardStatus: "draft" });
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={AWARD_ID} canDaoFinalize canDoFinalize={false} />);
    expect(screen.queryByRole("button", { name: "DO Finalize Award" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DAO Finalize Award" })).toBeInTheDocument();
  });

  it("disables DO finalize until the award is DAO-finalized", async () => {
    mockFetch({ awardStatus: "draft" });
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={AWARD_ID} canDaoFinalize canDoFinalize />);
    await waitFor(() => expect(screen.getByRole("button", { name: "DO Finalize Award" })).toBeDisabled());
  });

  it("enables DO finalize once the award is DAO-finalized", async () => {
    mockFetch({ awardStatus: "dao_finalized" });
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={AWARD_ID} canDaoFinalize canDoFinalize />);
    await waitFor(() => expect(screen.getByRole("button", { name: "DO Finalize Award" })).not.toBeDisabled());
  });

  it("requires a reason before the DAO finalize confirm is enabled, then submits truthfully", async () => {
    const spy = mockFetch({ awardStatus: "draft" });
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={AWARD_ID} canDaoFinalize canDoFinalize />);

    fireEvent.click(screen.getByRole("button", { name: "DAO Finalize Award" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Finalize" });
    // Confirm is gated on a reason being typed.
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "DAO note 7781" } });
    expect(confirm).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() =>
      expect(spy.mock.calls.some((c) => String(c[0]).endsWith(`/award/${AWARD_ID}/dao-finalize`))).toBe(true),
    );
    await waitFor(() =>
      expect(screen.getByText("Award DAO finalization submitted. It will show as finalized once processed.")).toBeInTheDocument(),
    );
  });
});

describe("TenderActions — DETAIL-01 contractor picker on quotations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("blocks quotation submit until a registered contractor is picked", async () => {
    const spy = mockFetch();
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Quotation" }));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50000" } });
    // No contractor chosen yet.
    fireEvent.click(screen.getByRole("button", { name: "Submit Quotation" }));
    await waitFor(() => expect(screen.getByText("Select a registered contractor.")).toBeInTheDocument());
    // The quotation POST must not have fired.
    expect(spy.mock.calls.some((c) => String(c[0]).endsWith("/tenders/quotation"))).toBe(false);
  });
});

describe("TenderActions — DETAIL-06 award traces to a quotation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  const quotations: TenderQuotationOption[] = [
    { id: "q1", contractorId: CONTRACTOR_ID, contractorName: "ACME Builders", quotedAmountMinor: "5000000", method: "item_rate", status: "submitted" },
  ];

  it("requires selecting a quotation and prefills the accepted amount from it", async () => {
    const spy = mockFetch();
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} quotations={quotations} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Create Award" }));

    // Submitting with no quotation selected is blocked.
    fireEvent.click(screen.getByRole("button", { name: "Create Award" }));
    await waitFor(() => expect(screen.getByText("Select the quotation being awarded.")).toBeInTheDocument());
    expect(spy.mock.calls.some((c) => String(c[0]).endsWith("/tenders/award"))).toBe(false);

    // Select the quotation — accepted amount prefills from its paise value.
    fireEvent.change(screen.getByLabelText(/Award this quotation/i), { target: { value: "q1" } });
    const amount = screen.getByLabelText(/Accepted Amount/i) as HTMLInputElement;
    await waitFor(() => expect(amount.value).toBe("50000.00"));

    fireEvent.click(screen.getByRole("button", { name: "Create Award" }));
    await waitFor(() => expect(spy.mock.calls.some((c) => String(c[0]).endsWith("/tenders/award"))).toBe(true));
    const call = spy.mock.calls.find((c) => String(c[0]).endsWith("/tenders/award"))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.contractorId).toBe(CONTRACTOR_ID);
    expect(body.acceptedAmountMinor).toBe("5000000");
  });
});

describe("TenderActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when creating an award fails", async () => {
    mockFetch({ actionStatus: 409 });
    const quotations: TenderQuotationOption[] = [
      { id: "q1", contractorId: CONTRACTOR_ID, contractorName: "ACME Builders", quotedAmountMinor: "5000000", method: "item_rate", status: "submitted" },
    ];
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} quotations={quotations} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Create Award" }));
    fireEvent.change(screen.getByLabelText(/Award this quotation/i), { target: { value: "q1" } });
    await waitFor(() => expect((screen.getByLabelText(/Accepted Amount/i) as HTMLInputElement).value).toBe("50000.00"));
    fireEvent.click(screen.getByRole("button", { name: "Create Award" }));

    await waitFor(() => expect(screen.getByText(/changed by someone else\. Refresh to see the latest version, then try again\./)).toBeInTheDocument());
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw server text, when adding a quotation fails", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).includes("/works/contractors")) {
        return new Response(JSON.stringify({ data: [{ id: CONTRACTOR_ID, name: "ACME Builders", registrationNo: "REG-1" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("Request failed", { status: 500 });
    });
    renderWithToast(<TenderActions tenderId={TENDER_ID} workId="w1" awardId={null} />);
    fireEvent.click(screen.getByRole("button", { name: "+ Add Quotation" }));
    const combo = document.getElementById("tender-quot-contractor") as HTMLElement;
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "ACME" } });
    fireEvent.mouseDown(await screen.findByText("ACME Builders"));
    fireEvent.change(screen.getByPlaceholderText("0.00"), { target: { value: "50000" } });
    // Let the picked contractor resolve to its label before submitting.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    fireEvent.click(screen.getByRole("button", { name: "Submit Quotation" }));

    await waitFor(() => expect(screen.getByText(/couldn.t save/i)).toBeInTheDocument());
    expect(screen.queryByText(/^Request failed$/)).not.toBeInTheDocument();
  });
});
