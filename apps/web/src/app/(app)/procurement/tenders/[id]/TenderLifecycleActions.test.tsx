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

// Regression suite for a CRITICAL L1/L2 gap: services/procurement-service
// exposes publish, technical-evaluation, open-financial, and award as real
// endpoints (tender/routes.ts) with a full state machine (tender/domain.ts:
// draft -> published -> technical_evaluation -> financial_evaluation ->
// awarded), but before this component there was NO UI for any of the four —
// a tender could be created and viewed, never taken further.
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

  it("shows the technical evaluation form (not Open financial / Award) once published with bids", () => {
    const bids = [bid({ bidId: "b-1", vendorName: "Acme Traders" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="published" bids={bids} />);

    expect(screen.getByText("Technical evaluation")).toBeInTheDocument();
    expect(screen.getByText("Acme Traders")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Open financial bids" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Award tender" })).not.toBeInTheDocument();
  });

  it("shows the evaluation form AND Open financial bids while status is 'evaluation' with no revealed amounts yet", () => {
    const bids = [bid({ bidId: "b-1" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="evaluation" bids={bids} />);

    expect(screen.getByText("Technical evaluation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open financial bids" })).toBeInTheDocument();
    // Award requires a provably-opened financial envelope — not yet available.
    expect(screen.queryByRole("button", { name: "Award tender" })).not.toBeInTheDocument();
  });

  it("hides the evaluation form and shows Award once a bid's financial envelope is revealed", () => {
    // bidAmount present at all (even 0) means the sealing guard has released
    // it — the signal this component uses since the collapsed "evaluation"
    // status can't itself distinguish technical_evaluation from
    // financial_evaluation (procurement-service's queries.ts intentionally
    // merges the two for the summary/detail views).
    const bids = [bid({ bidId: "b-1", bidAmount: 450000, status: "technically_qualified" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="evaluation" bids={bids} />);

    expect(screen.queryByText("Technical evaluation")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open financial bids" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Award tender" })).toBeInTheDocument();
    expect(screen.getByLabelText("Sanction reference (optional)")).toBeInTheDocument();
  });

  it("awards with the optional sanction reference and posts to .../award", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const bids = [bid({ bidId: "b-1", bidAmount: 450000 })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="evaluation" bids={bids} />);

    fireEvent.change(screen.getByLabelText("Sanction reference (optional)"), { target: { value: "SANC/2026/44" } });
    fireEvent.click(screen.getByRole("button", { name: "Award tender" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Award this tender?" });
    fireEvent.click(within(dialog).getByRole("button", { name: "Award" }));

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith(
      `/api/proxy/v1/procurement/tenders/${TENDER_ID}/award`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ sanctionRef: "SANC/2026/44" }) }),
    );
  });

  it("submits per-bid technical evaluation results in the shape the backend expects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 200 }));
    const bids = [
      bid({ bidId: "b-1", vendorName: "Acme Traders" }),
      bid({ bidId: "b-2", vendorName: "Bharat Supplies", vendorId: "v-2" }),
    ];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="published" bids={bids} />);

    fireEvent.click(screen.getByLabelText("Acme Traders technically qualified"));
    fireEvent.change(screen.getByLabelText("Acme Traders technical score"), { target: { value: "88" } });
    // Bharat Supplies left unqualified with no score.

    fireEvent.click(screen.getByRole("button", { name: "Save technical evaluation" }));

    await waitFor(() => {
      expect(screen.getByText("Evaluation submitted.")).toBeInTheDocument();
    });
    const [, init] = fetchSpy.mock.calls.find(([url]) => String(url).includes("technical-evaluation"))!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      results: [
        { bidId: "b-1", qualified: true, score: 88 },
        { bidId: "b-2", qualified: false, score: undefined },
      ],
    });
  });

  it("does not render evaluation UI for a bid with no bidId (can't be addressed by the API)", () => {
    const bids = [bid({ bidId: undefined, vendorName: "Legacy Vendor Without Bid Id" })];
    render(<TenderLifecycleActions tenderId={TENDER_ID} status="published" bids={bids} />);
    expect(screen.queryByText("Technical evaluation")).not.toBeInTheDocument();
  });
});
