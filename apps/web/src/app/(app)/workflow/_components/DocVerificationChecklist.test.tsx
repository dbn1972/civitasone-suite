import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { DocVerificationChecklist } from "./DocVerificationChecklist";

describe("DocVerificationChecklist (GAP-WORKFLOW-INSTANCES-DETAIL-02)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("shows a visible indicator and Retry in compact mode on error (not null)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 500 }) as unknown as Response);
    const onState = vi.fn();
    render(<DocVerificationChecklist laneKey="inspection" applicationId="app-1" compact onState={onState} />);
    await waitFor(() => expect(screen.getByText("Docs: unavailable")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Retry document checklist" })).toBeInTheDocument();
    await waitFor(() => expect(onState).toHaveBeenCalledWith(expect.objectContaining({ status: "error" })));
  });

  it("reports missing mandatory docs via onState and shows a summary chip", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ items: [
          { docType: "pan", label: "PAN", mandatory: true, provided: false, verified: false },
          { docType: "photo", label: "Photo", mandatory: false, provided: true, verified: true },
        ] }),
        { status: 200 },
      ) as unknown as Response,
    );
    const onState = vi.fn();
    render(<DocVerificationChecklist laneKey="inspection" applicationId="app-missing" onState={onState} />);
    await waitFor(() => expect(screen.getByText("1 mandatory missing")).toBeInTheDocument());
    await waitFor(() => expect(onState).toHaveBeenCalledWith({ status: "ready", missingMandatory: 1 }));
  });
});
