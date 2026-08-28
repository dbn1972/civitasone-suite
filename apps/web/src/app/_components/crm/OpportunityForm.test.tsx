import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OpportunityForm } from "./OpportunityForm";
import * as op from "@/lib/crm/opportunity";

vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return { ...actual, getPipelines: vi.fn(), createOpportunity: vi.fn(), updateOpportunity: vi.fn() };
});

const pipeline: op.Pipeline = {
  id: "p1",
  name: "Enterprise",
  enabled: true,
  stages: [
    { key: "qual", name: "Qualify", mandatoryFields: [], gate: false },
    { key: "propose", name: "Propose", mandatoryFields: ["value", "product"], gate: false },
  ],
};

beforeEach(() => {
  vi.mocked(op.getPipelines).mockReset();
  vi.mocked(op.createOpportunity).mockReset();
  vi.mocked(op.updateOpportunity).mockReset();
});

describe("OpportunityForm (OP-003)", () => {
  it("shows the saved-info badge when pipelines fail to load", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "error" });
    render(<OpportunityForm />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("converts the rupee value to paise and creates the opportunity", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockResolvedValue(undefined);
    render(<OpportunityForm />);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Datacentre" } });
    fireEvent.change(screen.getByLabelText(/deal value in rupees/i), { target: { value: "1500.50" } });
    fireEvent.change(screen.getByLabelText(/probability percent/i), { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    await waitFor(() => expect(op.createOpportunity).toHaveBeenCalled());
    const payload = vi.mocked(op.createOpportunity).mock.calls[0][0];
    expect(payload.valueMinor).toBe("150050");
    expect(payload.probability).toBe(40);
    expect(payload.pipelineId).toBe("p1");
    expect(payload.stage).toBe("qual");
  });

  it("blocks an invalid probability without calling the API", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    render(<OpportunityForm />);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "X" } });
    fireEvent.change(screen.getByLabelText(/probability percent/i), { target: { value: "150" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    expect(await screen.findByText(/between 0 and 100/i)).toBeInTheDocument();
    expect(op.createOpportunity).not.toHaveBeenCalled();
  });

  it("surfaces the 422 MANDATORY_STAGE_FIELDS_MISSING fields inline", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.createOpportunity).mockRejectedValue(new op.MandatoryFieldsError("needs more", ["value", "product"]));
    render(<OpportunityForm />);
    await waitFor(() => expect(screen.getByLabelText(/opportunity name/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/opportunity name/i), { target: { value: "Y" } });
    fireEvent.change(screen.getByLabelText(/^stage$/i), { target: { value: "propose" } });
    fireEvent.click(screen.getByRole("button", { name: /create opportunity/i }));
    expect(await screen.findByText(/this stage needs:.*deal value.*product/i)).toBeInTheDocument();
  });
});
