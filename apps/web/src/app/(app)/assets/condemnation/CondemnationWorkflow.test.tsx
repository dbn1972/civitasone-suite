import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));

import { CondemnationWorkflow, type CondemnationData } from "./CondemnationWorkflow";

const ASSET_ID = "11111111-1111-4111-8111-111111111111";
const SURVEY_DRAFT = "22222222-2222-4222-8222-222222222221";
const SURVEY_SUBMITTED = "22222222-2222-4222-8222-222222222222";
const REC_PENDING = "33333333-3333-4333-8333-333333333331";
const REC_APPROVED = "33333333-3333-4333-8333-333333333332";
const AUCTION_ID = "44444444-4444-4444-8444-444444444444";

const DATA: CondemnationData = {
  assets: [{ id: ASSET_ID, label: "VEH/007 · Ambassador car" }],
  surveys: [
    { id: SURVEY_DRAFT, assetId: ASSET_ID, status: "draft", condition: "beyond_repair", surveyDate: "2026-08-01", version: 1 },
    { id: SURVEY_SUBMITTED, assetId: ASSET_ID, status: "submitted", condition: "unserviceable", surveyDate: "2026-07-01", version: 2 },
  ],
  recommendations: [
    { id: REC_PENDING, surveyId: SURVEY_SUBMITTED, assetId: ASSET_ID, decision: "condemn", status: "pending", version: 3, reserveValueMinor: "5000000", floorValueMinor: "4000000" },
    { id: REC_APPROVED, surveyId: SURVEY_SUBMITTED, assetId: ASSET_ID, decision: "condemn", status: "approved", version: 4, reserveValueMinor: "6000050", floorValueMinor: null },
  ],
  auctions: [{ id: AUCTION_ID, assetId: ASSET_ID, recommendationId: REC_APPROVED, status: "pending", version: 5, reserveValueMinor: "6000050" }],
  failed: {},
};

function accepted(id = "x") {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ id, status: "accepted", correlationId: "c" }), { status: 202 }));
}
const bodyOf = (spy: ReturnType<typeof accepted>, i = 0) => JSON.parse((spy.mock.calls[i]![1] as RequestInit).body as string);
const urlOf = (spy: ReturnType<typeof accepted>, i = 0) => String(spy.mock.calls[i]![0]);

describe("CondemnationWorkflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // GAP-ASSETS-CONDEMNATION-01
  it("creates a survey for an asset picked by code · name (no UUID typing)", async () => {
    const spy = accepted();
    render(<CondemnationWorkflow data={DATA} />);
    const asset = screen.getByLabelText(/^Asset/) as HTMLSelectElement;
    expect(asset.tagName).toBe("SELECT");
    fireEvent.change(asset, { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Condition/ }), { target: { value: "unserviceable" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    await waitFor(() => expect(screen.getByText("Create this condemnation survey?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create survey" }));
    await waitFor(() => expect(screen.getByText(/Survey for VEH\/007 · Ambassador car submitted/)).toBeInTheDocument());
    expect(bodyOf(spy)).toMatchObject({ assetId: ASSET_ID, condition: "unserviceable" });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe message when creating a survey fails (UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "assetId not found" }), { status: 400 }));
    render(<CondemnationWorkflow data={DATA} />);
    fireEvent.change(screen.getByLabelText(/^Asset/), { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Condition/ }), { target: { value: "poor" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    await waitFor(() => expect(screen.getByText("Create this condemnation survey?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create survey" }));
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/VALIDATION_FAILED: assetId not found/)).not.toBeInTheDocument();
  });

  it("focuses the asset picker when nothing is selected", () => {
    render(<CondemnationWorkflow data={DATA} />);
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    expect(screen.getByText("Select the asset being surveyed.")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Asset/)).toHaveFocus();
  });

  // GAP-ASSETS-CONDEMNATION-02: version comes from the fetched record
  it("submits a draft survey with the record's own version (no version field)", async () => {
    const spy = accepted();
    render(<CondemnationWorkflow data={DATA} />);
    expect(screen.queryByLabelText(/Current version/)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/^Draft survey/), { target: { value: SURVEY_DRAFT } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Recommendation/ }), { target: { value: "condemn" } });
    fireEvent.click(screen.getByRole("button", { name: "Submit Survey" }));
    await waitFor(() => expect(screen.getByText("Submit this survey?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Submit survey" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(urlOf(spy)).toContain(`condemnation-surveys/${SURVEY_DRAFT}/submit`);
    expect(bodyOf(spy)).toEqual({ version: 1, recommendation: "condemn" });
  });

  it("only offers submitted surveys for a recommendation and derives the asset from the survey", async () => {
    const spy = accepted();
    render(<CondemnationWorkflow data={DATA} />);
    const surveySel = screen.getByLabelText(/^Submitted survey/);
    expect(within(surveySel).getAllByRole("option")).toHaveLength(2); // placeholder + the one submitted survey
    fireEvent.change(surveySel, { target: { value: SURVEY_SUBMITTED } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Decision/ }), { target: { value: "condemn" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Beyond economical repair" } });
    fireEvent.change(screen.getByLabelText("Member 1 name"), { target: { value: "A" } });
    fireEvent.change(screen.getByLabelText("Member 1 designation"), { target: { value: "DDO" } });
    fireEvent.change(screen.getByLabelText("Member 2 name"), { target: { value: "B" } });
    fireEvent.change(screen.getByLabelText("Member 2 designation"), { target: { value: "AO" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Recommendation" }));
    await waitFor(() => expect(screen.getByText("Create this committee recommendation?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create recommendation" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(bodyOf(spy)).toMatchObject({ surveyId: SURVEY_SUBMITTED, assetId: ASSET_ID, decision: "condemn" });
  });

  it("focuses the first committee-member field when fewer than 2 members are filled in", () => {
    render(<CondemnationWorkflow data={DATA} />);
    fireEvent.change(screen.getByLabelText(/^Submitted survey/), { target: { value: SURVEY_SUBMITTED } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Decision/ }), { target: { value: "condemn" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Recommendation" }));
    expect(screen.getByLabelText("Member 1 name")).toHaveFocus();
  });

  // GAP-ASSETS-CONDEMNATION-03
  it("approve dialog shows the selected recommendation's own reserve/floor and requires a reason", async () => {
    const spy = accepted();
    render(<CondemnationWorkflow data={DATA} />);
    // Type DIFFERENT figures into the create form: they must NOT leak into the approve dialog.
    fireEvent.change(screen.getAllByLabelText(/^Reserve value/)[0]!, { target: { value: "999" } });
    fireEvent.change(screen.getByLabelText(/^Pending recommendation/), { target: { value: REC_PENDING } });
    fireEvent.click(screen.getByRole("button", { name: "Approve Recommendation" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("₹50,000.00")).toBeInTheDocument();
    expect(within(dialog).getByText("₹40,000.00")).toBeInTheDocument();
    expect(within(dialog).queryByText("₹999.00")).not.toBeInTheDocument();
    const confirm = within(dialog).getByRole("button", { name: "Submit approval" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText("Reason for approval"), { target: { value: "Committee minutes 12/2026" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Submit approval" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(urlOf(spy)).toContain(`condemnation-recommendations/${REC_PENDING}/approve`);
    expect(bodyOf(spy)).toEqual({ version: 3, reason: "Committee minutes 12/2026" });
    await waitFor(() => expect(screen.getByText(/pending the maker≠checker verification/)).toBeInTheDocument());
  });

  it("only approved condemn recommendations can go to auction; reserve is prefilled from it", async () => {
    const spy = accepted();
    render(<CondemnationWorkflow data={DATA} />);
    const recSel = screen.getByLabelText(/^Approved recommendation/);
    expect(within(recSel).getAllByRole("option")).toHaveLength(2);
    fireEvent.change(recSel, { target: { value: REC_APPROVED } });
    const reserveInputs = screen.getAllByLabelText(/^Reserve value/);
    expect(reserveInputs.at(-1)).toHaveValue("60000.50");
    fireEvent.click(screen.getByRole("button", { name: "Create Auction" }));
    await waitFor(() => expect(screen.getByText("Create this auction?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create auction" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(bodyOf(spy)).toMatchObject({ assetId: ASSET_ID, recommendationId: REC_APPROVED, reserveValueMinor: 6000050 });
  });

  it("completes an open auction with its own version", async () => {
    const spy = accepted();
    render(<CondemnationWorkflow data={DATA} />);
    fireEvent.change(screen.getByLabelText(/^Open auction/), { target: { value: AUCTION_ID } });
    fireEvent.change(screen.getByLabelText(/^Winning bid/), { target: { value: "70000" } });
    fireEvent.change(screen.getByLabelText(/^Winner name/), { target: { value: "Scrap Co" } });
    fireEvent.change(screen.getByLabelText(/^Sale proceeds/), { target: { value: "70000" } });
    fireEvent.click(screen.getByRole("button", { name: "Complete Auction" }));
    await waitFor(() => expect(screen.getByText("Complete this auction?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Complete auction" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(urlOf(spy)).toContain(`auctions/${AUCTION_ID}/complete`);
    expect(bodyOf(spy)).toMatchObject({ version: 5, highestBidMinor: 7000000, saleProceedsMinor: 7000000 });
  });

  it("disables pickers with a load-failure note when a read model failed", () => {
    render(<CondemnationWorkflow data={{ ...DATA, surveys: [], failed: { surveys: true } }} />);
    expect(screen.getByLabelText(/^Draft survey/)).toBeDisabled();
    expect(screen.getAllByText("Couldn't load — refresh to retry").length).toBeGreaterThan(0);
    expect(screen.getByRole("alert")).toHaveTextContent(/couldn.t be loaded/);
  });
});
