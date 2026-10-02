import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { CondemnationWorkflow, type CondemnationData } from "./CondemnationWorkflow";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const REC_APPROVED = "33333333-3333-4333-8333-333333333332";
const AUCTION_ID = "44444444-4444-4444-8444-444444444444";

const DATA: CondemnationData = {
  assets: [{ id: ASSET_ID, label: "VEH/007 · Ambassador car" }],
  surveys: [],
  recommendations: [
    { id: REC_APPROVED, surveyId: "s", assetId: ASSET_ID, decision: "condemn", status: "approved", version: 4, reserveValueMinor: "6000050", floorValueMinor: null },
  ],
  auctions: [{ id: AUCTION_ID, assetId: ASSET_ID, recommendationId: REC_APPROVED, status: "pending", version: 5, reserveValueMinor: "6000050" }],
  failed: {},
};

function fillComplete(bid: string, proceeds: string) {
  fireEvent.change(screen.getByLabelText(/^Open auction/), { target: { value: AUCTION_ID } });
  fireEvent.change(screen.getByLabelText(/^Winning bid/), { target: { value: bid } });
  fireEvent.change(screen.getByLabelText(/^Winner name/), { target: { value: "Scrap Co" } });
  fireEvent.change(screen.getByLabelText(/^Sale proceeds/), { target: { value: proceeds } });
  fireEvent.click(screen.getByRole("button", { name: "Complete Auction" }));
}

describe("CondemnationWorkflow (ml-assets-01)", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.useRealTimers(); });

  // GAP-ASSETS-CONDEMNATION-04
  it("blocks completing an auction when the winning bid is below its reserve", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    render(<CondemnationWorkflow data={DATA} />);
    fillComplete("50000", "50000");
    expect(screen.getByText(/below the auction reserve of ₹60,000\.50/)).toBeInTheDocument();
    expect(screen.queryByText("Complete this auction?")).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("blocks sale proceeds that exceed the winning bid", () => {
    const spy = vi.spyOn(globalThis, "fetch");
    render(<CondemnationWorkflow data={DATA} />);
    fillComplete("70000", "70000.01");
    expect(screen.getByText("Sale proceeds cannot be more than the winning bid.")).toBeInTheDocument();
    expect(screen.queryByText("Complete this auction?")).not.toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it("warns when the auction reserve is changed from the approved recommendation's figure", () => {
    render(<CondemnationWorkflow data={DATA} />);
    fireEvent.change(screen.getByLabelText(/^Approved recommendation/), { target: { value: REC_APPROVED } });
    expect(screen.queryByText(/uses a different figure/)).not.toBeInTheDocument();
    fireEvent.change(screen.getAllByLabelText(/^Reserve value/).at(-1)!, { target: { value: "1000" } });
    expect(screen.getByText(/set a reserve of ₹60,000\.50; this auction uses a different figure/)).toBeInTheDocument();
  });

  // GAP-ASSETS-CONDEMNATION-05
  it("lays committee member fields out responsively and picks the officer by name, not UUID", () => {
    render(<CondemnationWorkflow data={DATA} />);
    const officer = screen.getByLabelText("Member 1 officer");
    expect(officer.tagName).toBe("INPUT");
    expect(officer).toHaveAttribute("placeholder", expect.stringMatching(/Search by name/));
    expect(screen.queryByPlaceholderText(/Employee id/i)).not.toBeInTheDocument();
    const row = screen.getByLabelText("Member 1 name").closest("div[style*='grid-template-columns']") as HTMLElement;
    expect(row.style.gridTemplateColumns).toContain("auto-fit");
  });

  // GAP-ASSETS-CONDEMNATION-06
  it("asks for a bidder registration reference with a purpose note, not a PAN", () => {
    render(<CondemnationWorkflow data={DATA} />);
    expect(screen.getByLabelText("Bidder registration / contact reference")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/PAN/)).not.toBeInTheDocument();
    expect(screen.getByText(/Do not enter a PAN or other identity number/)).toBeInTheDocument();
  });

  // GAP-ASSETS-CONDEMNATION-07
  it("defaults the survey date to the IST calendar day (not UTC) and rejects a future date", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-31T20:00:00Z")); // 01:30 IST on 1 April
    render(<CondemnationWorkflow data={DATA} />);
    const date = screen.getByLabelText(/^Survey date/) as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.value).toBe("2026-04-01");
    fireEvent.change(screen.getByLabelText(/^Asset/), { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Condition/ }), { target: { value: "poor" } });
    fireEvent.change(date, { target: { value: "2026-04-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    expect(screen.getByText("A survey cannot be dated in the future.")).toBeInTheDocument();
  });

  // GAP-ASSETS-CONDEMNATION-08
  it("tells the clerk to refresh when the server answers 409 STALE_VERSION", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "STALE_VERSION", message: "x" }), { status: 409 }));
    render(<CondemnationWorkflow data={DATA} />);
    fillComplete("70000", "70000");
    fireEvent.click(await screen.findByRole("button", { name: "Complete auction" }));
    expect(await screen.findByText(/Someone else has changed this record.*Refresh the page/)).toBeInTheDocument();
  });

  it("explains a maker-checker refusal instead of a generic save error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "MAKER_CHECKER_VIOLATION" }), { status: 403 }));
    render(<CondemnationWorkflow data={{ ...DATA, recommendations: [{ ...DATA.recommendations[0]!, status: "pending" }] }} />);
    fireEvent.change(screen.getByLabelText(/^Pending recommendation/), { target: { value: REC_APPROVED } });
    fireEvent.click(screen.getByRole("button", { name: "Approve Recommendation" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText("Reason for approval"), { target: { value: "minutes" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit approval" }));
    expect(await screen.findByText(/you cannot approve it/)).toBeInTheDocument();
  });
});
