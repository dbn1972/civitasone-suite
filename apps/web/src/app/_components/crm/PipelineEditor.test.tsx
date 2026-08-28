import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { PipelineEditor } from "./PipelineEditor";
import * as op from "@/lib/crm/opportunity";

vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return { ...actual, getPipelines: vi.fn(), createPipeline: vi.fn(), updatePipeline: vi.fn(), deletePipeline: vi.fn() };
});

const pipeline: op.Pipeline = {
  id: "p1",
  name: "Enterprise",
  enabled: true,
  stages: [{ key: "qual", name: "Qualify", mandatoryFields: ["value"], gate: true }],
};

beforeEach(() => {
  vi.mocked(op.getPipelines).mockReset();
  vi.mocked(op.createPipeline).mockReset();
  vi.mocked(op.updatePipeline).mockReset();
  vi.mocked(op.deletePipeline).mockReset();
});

describe("PipelineEditor (OP-002)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "error" });
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("creates a pipeline with a stage and its mandatory field", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(op.createPipeline).mockResolvedValue(undefined);
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText(/no pipelines yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new pipeline/i }));
    fireEvent.change(screen.getByLabelText(/pipeline name/i), { target: { value: "SMB" } });
    fireEvent.change(screen.getByLabelText(/stage 1 name/i), { target: { value: "Discover" } });
    fireEvent.click(screen.getByLabelText(/deal value mandatory for stage 1/i));
    fireEvent.click(screen.getByRole("button", { name: /create pipeline/i }));
    await waitFor(() => expect(op.createPipeline).toHaveBeenCalled());
    const payload = vi.mocked(op.createPipeline).mock.calls[0][0];
    expect(payload.name).toBe("SMB");
    expect(payload.stages[0].mandatoryFields).toContain("value");
  });

  it("blocks save when the pipeline name is empty", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "api" });
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText(/no pipelines yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new pipeline/i }));
    fireEvent.click(screen.getByRole("button", { name: /create pipeline/i }));
    expect(await screen.findByText(/needs a name and at least one named stage/i)).toBeInTheDocument();
    expect(op.createPipeline).not.toHaveBeenCalled();
  });

  it("edits and updates an existing pipeline via PUT", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.updatePipeline).mockResolvedValue(undefined);
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/pipeline name/i), { target: { value: "Enterprise Plus" } });
    fireEvent.click(screen.getByRole("button", { name: /save pipeline/i }));
    await waitFor(() => expect(op.updatePipeline).toHaveBeenCalledWith("p1", expect.objectContaining({ name: "Enterprise Plus" })));
  });

  it("deletes a pipeline only after confirmation", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.deletePipeline).mockResolvedValue(undefined);
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete pipeline enterprise/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^delete pipeline$/i }));
    await waitFor(() => expect(op.deletePipeline).toHaveBeenCalledWith("p1"));
  });
});
