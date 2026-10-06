import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { TenderLifecycleActions, type LifecycleBid } from "./TenderLifecycleActions";

const TENDER_ID = "44444444-4444-4444-4444-444444444444";

function bid(overrides: Partial<LifecycleBid>): LifecycleBid {
  return {
    bidId: "b-1",
    vendorId: "v-1",
    vendorName: "Acme Traders",
    status: "submitted",
    ...overrides,
  };
}

// Regression suite for GAP-PROCUREMENT-TENDERS-DETAIL-01/02/03: the lifecycle
// is now gated on the REAL phase (technical_evaluation / financial_evaluation),
// the technical form is tri-state (never silently disqualifies an untouched
// form) with required reasons, Award is maker-checker gated and requires a
// sanction reference, and server errors surface as human sentences.
describe("TenderLifecycleActions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders nothing for awarded or cancelled tenders", () => {
    const { container: awarded } = render(<TenderLifecycleActions tenderId={TENDER_ID} status="awarded" bids={[]} />);
    expect(awarded).toBeEmptyDOMElement();
    const { container: cancelled } = render(<TenderLifecycleActions tenderId={TENDER_ID} status="cancelled" bids={[]} />);
    expect(cancelled).toBeEmptyDOMElement();
  });

  it("shows only Publish for a draft tender, and POSTs .../publish on confirm", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="draft" bids={[]} />);

    expect(screen.queryByRole("button", { name: "Open financial bids" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Publish tender" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Publish this tender?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/v1/procurement/tenders/${TENDER_ID}/publish`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("DETAIL-02: shows the technical form in technical_evaluation; no Award button there", () => {
    const bids = [bid({ bidId: "b-1", vendorName: "Acme Traders" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="technical_evaluation" bids={bids} />);

    expect(screen.getByText("Technical evaluation")).toBeInTheDocument();
    expect(screen.getByText("Acme Traders")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Award tender" })).not.toBeInTheDocument();
  });

  it("DETAIL-02: 'Open financial bids' is disabled until a bid is technically qualified", () => {
    const bids = [bid({ bidId: "b-1", status: "submitted" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="technical_evaluation" bids={bids} />);
    expect(screen.getByRole("button", { name: "Open financial bids" })).toBeDisabled();
  });

  it("DETAIL-02: in financial_evaluation the technical form and Open-financial are gone; Award appears", () => {
    const bids = [bid({ bidId: "b-1", status: "technically_qualified", financialOpened: true, bidAmount: 450000 })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="financial_evaluation" bids={bids} />);

    expect(screen.queryByText("Technical evaluation")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open financial bids" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Award tender" })).toBeInTheDocument();
  });

  it("DETAIL-03: Award is disabled with no sanction reference, enabled once one is typed", () => {
    const bids = [bid({ bidId: "b-1", status: "technically_qualified", financialOpened: true, bidAmount: 450000 })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="financial_evaluation" bids={bids} />);

    expect(screen.getByRole("button", { name: "Award tender" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Sanction reference"), { target: { value: "SANC/2026/44" } });
    expect(screen.getByRole("button", { name: "Award tender" })).toBeEnabled();
  });

  it("DETAIL-03: Award stays disabled for a blocked (maker-checker) user and shows the reason", () => {
    const bids = [bid({ bidId: "b-1", status: "technically_qualified", financialOpened: true, bidAmount: 450000 })];
    render(
      <TenderLifecycleActions
        tenderId={TENDER_ID}
        status="financial_evaluation"
        bids={bids}
        canAward={false}
        awardBlockReason="You created this tender — the approver must differ from the creator."
      />,
    );
    fireEvent.change(screen.getByLabelText("Sanction reference"), { target: { value: "SANC/2026/44" } });
    expect(screen.getByRole("button", { name: "Award tender" })).toBeDisabled();
    expect(screen.getByText(/approver must differ from the creator/)).toBeInTheDocument();
  });

  it("DETAIL-03: awards with the sanction reference and posts to .../award", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const bids = [bid({ bidId: "b-1", status: "technically_qualified", financialOpened: true, bidAmount: 450000 })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="financial_evaluation" bids={bids} />);

    fireEvent.change(screen.getByLabelText("Sanction reference"), { target: { value: "SANC/2026/44" } });
    fireEvent.click(screen.getByRole("button", { name: "Award tender" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Award this tender?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Award" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/v1/procurement/tenders/${TENDER_ID}/award`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ sanctionRef: "SANC/2026/44" }) }),
    );
  });

  it("DETAIL-01: Save is blocked until every bid has a decision (an untouched form can't disqualify everyone)", () => {
    const bids = [
      bid({ bidId: "b-1", vendorName: "Acme Traders" }),
      bid({ bidId: "b-2", vendorName: "Bharat Supplies", vendorId: "v-2" }),
    ];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="technical_evaluation" bids={bids} />);
    // Nothing chosen yet.
    expect(screen.getByRole("button", { name: "Save technical evaluation" })).toBeDisabled();
    expect(screen.getByText(/Record a decision for every bidder/)).toBeInTheDocument();
  });

  it("DETAIL-01: a disqualified bid without a reason keeps Save disabled", () => {
    const bids = [bid({ bidId: "b-1", vendorName: "Acme Traders" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="technical_evaluation" bids={bids} />);
    fireEvent.click(screen.getByLabelText("Acme Traders disqualified"));
    expect(screen.getByRole("button", { name: "Save technical evaluation" })).toBeDisabled();
    // Supply a reason -> enabled.
    fireEvent.change(screen.getByLabelText("Acme Traders disqualification reason"), { target: { value: "Did not meet turnover criterion" } });
    expect(screen.getByRole("button", { name: "Save technical evaluation" })).toBeEnabled();
  });

  it("DETAIL-01: submits per-bid results with qualified flags and disqualification notes", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const bids = [
      bid({ bidId: "b-1", vendorName: "Acme Traders" }),
      bid({ bidId: "b-2", vendorName: "Bharat Supplies", vendorId: "v-2" }),
    ];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="technical_evaluation" bids={bids} />);

    fireEvent.click(screen.getByLabelText("Acme Traders qualified"));
    fireEvent.change(screen.getByLabelText("Acme Traders technical score"), { target: { value: "88" } });
    fireEvent.click(screen.getByLabelText("Bharat Supplies disqualified"));
    fireEvent.change(screen.getByLabelText("Bharat Supplies disqualification reason"), { target: { value: "Incomplete EMD" } });

    fireEvent.click(screen.getByRole("button", { name: "Save technical evaluation" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Submit technical evaluation?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByText("Evaluation submitted.")).toBeInTheDocument());
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("technical-evaluation"))!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({
      results: [
        { bidId: "b-1", qualified: true, score: 88 },
        { bidId: "b-2", qualified: false, score: undefined, notes: "Incomplete EMD" },
      ],
    });
  });

  it("DETAIL-02: a server 409 on Award surfaces a human sentence, not the raw body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "INVALID_TRANSITION", message: "tender cannot transition" }), {
        status: 409,
        headers: { "content-type": "application/json" },
      }),
    );
    const bids = [bid({ bidId: "b-1", status: "technically_qualified", financialOpened: true, bidAmount: 450000 })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="financial_evaluation" bids={bids} />);

    fireEvent.change(screen.getByLabelText("Sanction reference"), { target: { value: "SANC/2026/44" } });
    fireEvent.click(screen.getByRole("button", { name: "Award tender" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Award this tender?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Award" }));

    // The dialog shows the mapped human message; the raw JSON body is never shown.
    await waitFor(() => {
      expect(within(dialog).queryByText(/tender cannot transition/)).not.toBeInTheDocument();
      expect(within(dialog).getByText(/couldn't|could not|try again|conflict|already/i)).toBeInTheDocument();
    });
  });

  it("does not render evaluation UI for a bid with no bidId (can't be addressed by the API)", () => {
    const bids = [bid({ bidId: undefined, vendorName: "Legacy Vendor Without Bid Id" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="technical_evaluation" bids={bids} />);
    expect(screen.queryByText("Technical evaluation")).not.toBeInTheDocument();
  });

  it("legacy collapsed 'evaluation' status still shows the technical form and Open financial bids (no Award)", () => {
    const bids = [bid({ bidId: "b-1", status: "technically_qualified" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="evaluation" bids={bids} />);

    expect(screen.getByText("Technical evaluation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open financial bids" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Award tender" })).not.toBeInTheDocument();
  });

  it("technical evaluation save: an error response surfaces a human sentence, not a raw body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error at /srv/tender.js:9", { status: 500, headers: { "content-type": "text/plain" } }),
    );
    const bids = [bid({ bidId: "b-1", vendorName: "Acme Traders" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="technical_evaluation" bids={bids} />);
    fireEvent.click(screen.getByLabelText("Acme Traders qualified"));
    fireEvent.click(screen.getByRole("button", { name: "Save technical evaluation" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Submit technical evaluation?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    const text = screen.getAllByRole("alert").map((n) => n.textContent).join(" ");
    expect(text).not.toMatch(/Internal Server Error|\b500\b|srv\/tender/);
  });
});
