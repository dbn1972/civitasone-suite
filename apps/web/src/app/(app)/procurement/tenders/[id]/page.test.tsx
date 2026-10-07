import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

const getSessionUserIdMock = vi.fn(() => "other-user" as string | null);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => getSessionUserIdMock(),
}));

import TenderDetailPage from "./page";

const TENDER_ID = "33333333-3333-3333-3333-333333333333";

type BuildOpts = {
  status?: string;
  createdBy?: string;
  techEvaluatedBy?: string | null;
  emdAmountMinor?: number;
  hasNit?: boolean;
  documentCount?: number;
  bids?: Array<Record<string, unknown>>;
};

function route(opts: BuildOpts) {
  const tender = {
    id: TENDER_ID,
    tenderNo: "T-2026/12",
    title: "Supply of laptops",
    type: "open",
    estimatedValue: 500000,
    bidClosingDate: "2026-03-01",
    status: opts.status ?? "financial_evaluation",
    bidsReceived: opts.bids?.length ?? 0,
    emdAmountMinor: opts.emdAmountMinor,
    createdBy: opts.createdBy,
    techEvaluatedBy: opts.techEvaluatedBy,
    hasNit: opts.hasNit,
    documentCount: opts.documentCount,
    bids: opts.bids ?? [],
  };
  fetchJsonMock.mockImplementation((_path: unknown, _empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
    const mapped = options?.mapResponse ? options.mapResponse(tender) : tender;
    return Promise.resolve({ data: mapped, source: "api" });
  });
}

describe("TenderDetailPage (GAP-PROCUREMENT-TENDERS-DETAIL-03/04/05)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionUserIdMock.mockReset();
    getSessionUserIdMock.mockReturnValue("other-user");
  });

  it("DETAIL-05: shows EMD in rupees and the document count", async () => {
    route({ emdAmountMinor: 5000000, documentCount: 3, hasNit: true });
    render(await TenderDetailPage({ params: { id: TENDER_ID } }));
    expect(screen.getByText("EMD")).toBeInTheDocument();
    expect(screen.getByText("₹50,000.00")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Documents \(3\)/ })).toBeInTheDocument();
  });

  it("DETAIL-05: a draft tender with no NIT shows the 'Attach NIT' cue", async () => {
    route({ status: "draft", hasNit: false, documentCount: 0 });
    render(await TenderDetailPage({ params: { id: TENDER_ID } }));
    expect(screen.getByText(/No NIT attached/)).toBeInTheDocument();
  });

  it("DETAIL-05: a draft tender WITH a NIT shows no cue", async () => {
    route({ status: "draft", hasNit: true, documentCount: 1 });
    render(await TenderDetailPage({ params: { id: TENDER_ID } }));
    expect(screen.queryByText(/No NIT attached/)).not.toBeInTheDocument();
  });

  it("DETAIL-04: bidder names are hidden ('Bidder N') while the tender is only published", async () => {
    route({
      status: "published",
      bids: [
        { vendorId: "v1", vendorName: "Acme Traders", status: "submitted" },
        { vendorId: "v2", vendorName: "Bharat Supplies", status: "submitted" },
      ],
    });
    render(await TenderDetailPage({ params: { id: TENDER_ID } }));
    expect(screen.getByText("Bidder 1")).toBeInTheDocument();
    expect(screen.getByText("Bidder 2")).toBeInTheDocument();
    expect(screen.queryByText("Acme Traders")).not.toBeInTheDocument();
    expect(screen.queryByText("Bharat Supplies")).not.toBeInTheDocument();
  });

  it("DETAIL-04: bidder names appear once the tender reaches technical_evaluation", async () => {
    route({
      status: "technical_evaluation",
      bids: [{ vendorId: "v1", vendorName: "Acme Traders", status: "technically_qualified" }],
    });
    render(await TenderDetailPage({ params: { id: TENDER_ID } }));
    expect(screen.getByText("Acme Traders")).toBeInTheDocument();
    expect(screen.queryByText("Bidder 1")).not.toBeInTheDocument();
  });

  it("DETAIL-03: the tender creator sees Award disabled with the maker-checker reason", async () => {
    getSessionUserIdMock.mockReturnValue("creator-1");
    route({
      status: "financial_evaluation",
      createdBy: "creator-1",
      bids: [{ vendorId: "v1", vendorName: "Acme", status: "technically_qualified", financialOpened: true, bidAmount: 450000 }],
    });
    render(await TenderDetailPage({ params: { id: TENDER_ID } }));
    expect(screen.getByText(/approver must differ from the creator/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Award tender" })).toBeDisabled();
  });

  it("DETAIL-03: a different user is not blocked by the maker-checker gate", async () => {
    getSessionUserIdMock.mockReturnValue("approver-9");
    route({
      status: "financial_evaluation",
      createdBy: "creator-1",
      techEvaluatedBy: "evaluator-2",
      bids: [{ vendorId: "v1", vendorName: "Acme", status: "technically_qualified", financialOpened: true, bidAmount: 450000 }],
    });
    render(await TenderDetailPage({ params: { id: TENDER_ID } }));
    expect(screen.queryByText(/approver must differ/)).not.toBeInTheDocument();
  });
});
