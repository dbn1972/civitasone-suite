import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { CondemnationWorkflow } from "./CondemnationWorkflow";

const ASSET_ID = "11111111-1111-1111-1111-111111111111";
const SURVEY_ID = "22222222-2222-2222-2222-222222222222";
const RECOMMENDATION_ID = "33333333-3333-3333-3333-333333333333";

describe("CondemnationWorkflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates a condemnation survey on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: SURVEY_ID, status: "accepted", correlationId: "c-1" }), { status: 202 }),
    );

    render(<CondemnationWorkflow />);

    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[0], { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByLabelText(/Survey date/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Condition/ }), { target: { value: "unserviceable" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    await waitFor(() => expect(screen.getByText("Create this condemnation survey?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create survey" }));

    await waitFor(() => {
      expect(screen.getByText(new RegExp(`Survey submitted — tracking id ${SURVEY_ID}`))).toBeInTheDocument();
    });

    // The returned id is carried forward into the "Submit survey" panel's
    // field (index 0; the recommendation-create panel's Survey ID is index 1).
    expect(screen.getAllByLabelText(/^Survey ID/)[0]).toHaveValue(SURVEY_ID);
  });

  it("surfaces a server error when creating a survey fails (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "assetId not found" }), { status: 400 }),
    );

    render(<CondemnationWorkflow />);

    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[0], { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByLabelText(/Survey date/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Condition/ }), { target: { value: "poor" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    await waitFor(() => expect(screen.getByText("Create this condemnation survey?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create survey" }));

    await waitFor(() => {
      expect(screen.getByText(/VALIDATION_FAILED: assetId not found/)).toBeInTheDocument();
    });
  });

  it("blocks submit until every required field is valid, focusing the first invalid field", () => {
    render(<CondemnationWorkflow />);
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    expect(screen.getByText("Enter a valid asset ID (UUID).")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Asset ID/)[0]).toHaveFocus();
  });

  it("submits a recommendation approval and reports it as submitted for maker-checker verification, never as approved", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: RECOMMENDATION_ID, status: "accepted", correlationId: "c-2" }), { status: 202 }),
    );

    render(<CondemnationWorkflow />);

    // "Recommendation ID" also appears in the auction-create panel; the
    // recommendation-approve one is the first in document order.
    fireEvent.change(screen.getAllByLabelText(/Recommendation ID/)[0], { target: { value: RECOMMENDATION_ID } });
    // "Current version" is also present in the survey-submit and auction-complete
    // panels; the recommendation-approve one is the second in document order.
    fireEvent.change(screen.getAllByLabelText(/Current version/)[1], { target: { value: "2" } });

    fireEvent.click(screen.getByRole("button", { name: "Approve Recommendation" }));
    await waitFor(() => expect(screen.getByText("Approve this condemnation recommendation?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Submit approval" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Approval submitted for recommendation .* pending the checker's maker≠checker verification/),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/recommendation approved/i)).not.toBeInTheDocument();
  });

  it("carries the survey id and asset id forward into the recommendation panel's fields", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: SURVEY_ID, status: "accepted", correlationId: "c-3" }), { status: 202 }),
    );

    render(<CondemnationWorkflow />);

    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[0], { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByLabelText(/Survey date/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Condition/ }), { target: { value: "unserviceable" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    await waitFor(() => expect(screen.getByText("Create this condemnation survey?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Create survey" }));

    // "Survey ID" appears in the survey-submit panel (index 0, just written by
    // this test) and again as an input in the recommendation-create panel
    // (index 1) — it should have been carried forward automatically.
    await waitFor(() => expect(screen.getAllByLabelText(/^Survey ID/)[1]).toHaveValue(SURVEY_ID));

    // Asset ID is also carried into the recommendation panel (2nd occurrence)
    // and the auction panel (3rd occurrence).
    expect(screen.getAllByLabelText(/Asset ID/)[1]).toHaveValue(ASSET_ID);
    expect(screen.getAllByLabelText(/Asset ID/)[2]).toHaveValue(ASSET_ID);
  });

  it("focuses the Condition select when it's the first invalid survey-create field", () => {
    render(<CondemnationWorkflow />);
    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[0], { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByLabelText(/Survey date/), { target: { value: "2026-08-01" } });
    // Condition left unselected.
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    expect(screen.getByText("Select the condemnation condition.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Condition/ })).toHaveFocus();
  });

  it("focuses the repair-cost field when it's the only invalid survey-create field", () => {
    render(<CondemnationWorkflow />);
    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[0], { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByLabelText(/Survey date/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Condition/ }), { target: { value: "poor" } });
    fireEvent.change(screen.getByLabelText(/Estimated repair cost/), { target: { value: "not-a-number" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Survey" }));
    expect(
      screen.getByText("Enter a valid non-negative repair cost (₹) with at most 2 decimals."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Estimated repair cost/)).toHaveFocus();
  });

  it("focuses the Decision select when it's the first invalid recommendation-create field", () => {
    render(<CondemnationWorkflow />);
    fireEvent.change(screen.getAllByLabelText(/^Survey ID/)[1], { target: { value: SURVEY_ID } });
    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[1], { target: { value: ASSET_ID } });
    // Decision left unselected; reason/members also missing, but Decision is
    // validated first and should take focus.
    fireEvent.click(screen.getByRole("button", { name: "Create Recommendation" }));
    expect(screen.getByText("Select the committee's decision.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /^Decision/ })).toHaveFocus();
  });

  it("focuses the first committee-member field when fewer than 2 members are filled in", () => {
    render(<CondemnationWorkflow />);
    fireEvent.change(screen.getAllByLabelText(/^Survey ID/)[1], { target: { value: SURVEY_ID } });
    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[1], { target: { value: ASSET_ID } });
    fireEvent.change(screen.getByRole("combobox", { name: /^Decision/ }), { target: { value: "condemn" } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: "Beyond economical repair" } });
    // No committee members filled in.
    fireEvent.click(screen.getByRole("button", { name: "Create Recommendation" }));
    expect(
      screen.getByText("At least 2 committee members (name + designation) are required."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Member 1 name/)).toHaveFocus();
  });

  it("focuses the auction-date field when it's the only invalid auction-create field", () => {
    render(<CondemnationWorkflow />);
    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[2], { target: { value: ASSET_ID } });
    fireEvent.change(screen.getAllByLabelText(/Recommendation ID/)[1], { target: { value: RECOMMENDATION_ID } });
    // "Reserve value" also appears in the recommendation-create panel; the
    // auction-create one is the second in document order.
    fireEvent.change(screen.getAllByLabelText(/Reserve value/)[1], { target: { value: "50000" } });
    fireEvent.change(screen.getByLabelText(/Auction date/), { target: { value: "not-a-date" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Auction" }));
    expect(screen.getByText("Auction date must be YYYY-MM-DD.")).toBeInTheDocument();
    expect(screen.getByLabelText(/Auction date/)).toHaveFocus();
  });

  it("shows the asset id and reserve/floor value on the recommendation-approve confirm dialog", async () => {
    render(<CondemnationWorkflow />);

    // Reserve/floor value + asset id are filled in on the create panel; the
    // approve panel shares the same lifted assetId state.
    fireEvent.change(screen.getAllByLabelText(/Asset ID/)[1], { target: { value: ASSET_ID } });
    // "Reserve value" also appears in the auction-create panel; the
    // recommendation-create one is the first in document order.
    fireEvent.change(screen.getAllByLabelText(/Reserve value/)[0], { target: { value: "5000" } });
    fireEvent.change(screen.getByLabelText(/Floor value/), { target: { value: "3000" } });

    fireEvent.change(screen.getAllByLabelText(/Recommendation ID/)[0], { target: { value: RECOMMENDATION_ID } });
    fireEvent.change(screen.getAllByLabelText(/Current version/)[1], { target: { value: "1" } });
    fireEvent.click(screen.getByRole("button", { name: "Approve Recommendation" }));

    await waitFor(() => expect(screen.getByText("Approve this condemnation recommendation?")).toBeInTheDocument());
    const dialog = screen.getByText("Approve this condemnation recommendation?").closest(".cd-panel") as HTMLElement;
    expect(dialog).toHaveTextContent(new RegExp(`for asset ${ASSET_ID.slice(0, 8)}`));
    expect(dialog).toHaveTextContent("₹5,000.00");
    expect(dialog).toHaveTextContent("₹3,000.00");
  });
});
