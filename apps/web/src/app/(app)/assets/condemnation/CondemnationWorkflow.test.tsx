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
});
