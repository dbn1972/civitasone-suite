import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { PipelineEditor } from "./PipelineEditor";
import * as op from "@/lib/crm/opportunity";
import * as qp from "@/lib/crm/quotation";

import type { ReactElement } from "react";

function render(ui: ReactElement) {
  return rtlRender(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}


vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return { ...actual, getPipelines: vi.fn(), createPipeline: vi.fn(), updatePipeline: vi.fn(), deletePipeline: vi.fn() };
});

vi.mock("@/lib/crm/quotation", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/quotation")>();
  return { ...actual, getProducts: vi.fn() };
});

const pipeline: op.Pipeline = {
  id: "p1",
  name: "Enterprise",
  enabled: true,
  stages: [{ key: "qual", name: "Qualify", mandatoryFields: ["value"], gate: true }],
};

beforeEach(() => {
  vi.mocked(qp.getProducts).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(op.getPipelines).mockReset();
  vi.mocked(op.createPipeline).mockReset();
  vi.mocked(op.updatePipeline).mockReset();
  vi.mocked(op.deletePipeline).mockReset();
});

describe("PipelineEditor (OP-002)", () => {
  it("shows the saved-info badge on a failed load", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "error" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PipelineEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/couldn.t load/i)).toBeInTheDocument());
  });

  it("creates a pipeline with a stage and its mandatory field", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(op.createPipeline).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PipelineEditor /></NextIntlClientProvider>);
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
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PipelineEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText(/no pipelines yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new pipeline/i }));
    fireEvent.click(screen.getByRole("button", { name: /create pipeline/i }));
    expect(await screen.findByText(/needs a name and at least one named stage/i)).toBeInTheDocument();
    expect(op.createPipeline).not.toHaveBeenCalled();
  });

  it("edits and updates an existing pipeline via PUT", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.updatePipeline).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PipelineEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/pipeline name/i), { target: { value: "Enterprise Plus" } });
    fireEvent.click(screen.getByRole("button", { name: /save pipeline/i }));
    await waitFor(() => expect(op.updatePipeline).toHaveBeenCalledWith("p1", expect.objectContaining({ name: "Enterprise Plus" })));
  });

  it("deletes a pipeline only after confirmation", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.deletePipeline).mockResolvedValue(undefined);
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PipelineEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete pipeline enterprise/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^delete pipeline$/i }));
    await waitFor(() => expect(op.deletePipeline).toHaveBeenCalledWith("p1"));
  });

  // GAP-CRM-PIPELINES-01: when the server refuses the delete (409) because open deals
  // still reference the pipeline, the editor surfaces the server's count message rather
  // than silently succeeding.
  it("surfaces the server's deal-count message when deletion is refused (409)", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.deletePipeline).mockRejectedValue(new Error("cannot delete pipeline: 5 open deal(s) still reference it"));
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PipelineEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete pipeline enterprise/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^delete pipeline$/i }));
    expect(await screen.findByText(/5 open deal\(s\) still reference it/i)).toBeInTheDocument();
    // The pipeline is still listed (delete did not succeed).
    expect(screen.getByText("Enterprise")).toBeInTheDocument();
  });

  it("warns in the delete confirm text that open deals block deletion", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    render(<NextIntlClientProvider locale="en" messages={enMessages}><PipelineEditor /></NextIntlClientProvider>);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /delete pipeline enterprise/i }));
    expect(await screen.findByText(/the delete will be refused/i)).toBeInTheDocument();
  });

  // GAP-CRM-PIPELINES-02: stages can be reordered, and the save payload reflects
  // the new order (the server keys on stage key, not index).
  it("reorders stages and persists the new order on save", async () => {
    const twoStage: op.Pipeline = {
      id: "p2",
      name: "Flow",
      enabled: true,
      stages: [
        { key: "s1", name: "First", mandatoryFields: [], gate: false },
        { key: "s2", name: "Second", mandatoryFields: [], gate: false },
      ],
    };
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [twoStage], source: "api" });
    vi.mocked(op.updatePipeline).mockResolvedValue(undefined);
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Flow")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));

    // Move stage 1 ("First") down -> order becomes Second, First.
    fireEvent.click(screen.getByRole("button", { name: /move stage 1 down/i }));
    fireEvent.click(screen.getByRole("button", { name: /save pipeline/i }));

    await waitFor(() => expect(op.updatePipeline).toHaveBeenCalled());
    const payload = vi.mocked(op.updatePipeline).mock.calls[0][1];
    expect(payload.stages.map((s) => s.name)).toEqual(["Second", "First"]);
    // Keys travel with the stage (identity preserved, only order changed).
    expect(payload.stages.map((s) => s.key)).toEqual(["s2", "s1"]);
  });

  it("disables Move up on the first stage and Move down on the last", async () => {
    const twoStage: op.Pipeline = {
      id: "p2",
      name: "Flow",
      enabled: true,
      stages: [
        { key: "s1", name: "First", mandatoryFields: [], gate: false },
        { key: "s2", name: "Second", mandatoryFields: [], gate: false },
      ],
    };
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [twoStage], source: "api" });
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Flow")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    expect(screen.getByRole("button", { name: /move stage 1 up/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /move stage 2 down/i })).toBeDisabled();
  });

  // GAP-CRM-PIPELINES-04: the Gate control has a visible explanation (HelpTip).
  it("explains what Gate means via a help tip", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    const help = screen.getByRole("button", { name: /what is gate/i });
    fireEvent.click(help);
    expect(await screen.findByText(/requires an explicit review/i)).toBeInTheDocument();
  });

  // GAP-CRM-PIPELINES-06: a NEW stage's persisted key is slugified from its name
  // (not an opaque stage_N), so a stage named "Proposal" saves with key "proposal".
  it("derives a new stage's key from its name on save (not stage_N)", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [], source: "api" });
    vi.mocked(op.createPipeline).mockResolvedValue(undefined);
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText(/no pipelines yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /new pipeline/i }));
    fireEvent.change(screen.getByLabelText(/pipeline name/i), { target: { value: "Sales" } });
    fireEvent.change(screen.getByLabelText(/stage 1 name/i), { target: { value: "Proposal" } });
    fireEvent.click(screen.getByRole("button", { name: /create pipeline/i }));
    await waitFor(() => expect(op.createPipeline).toHaveBeenCalled());
    const payload = vi.mocked(op.createPipeline).mock.calls[0][0];
    expect(payload.stages[0].key).toBe("proposal");
    expect(payload.stages[0].key).not.toMatch(/^stage_/);
    expect(payload.stages[0].key).not.toMatch(/^__new_/);
  });

  // GAP-CRM-PIPELINES-06: renaming an ALREADY-PERSISTED stage must NOT change its
  // key (keys are immutable once saved, so stage limits keyed to them never orphan).
  it("keeps a persisted stage's key unchanged when it is renamed", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    vi.mocked(op.updatePipeline).mockResolvedValue(undefined);
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    // Rename the stage "Qualify" (persisted key "qual") to "Discovery".
    fireEvent.change(screen.getByLabelText(/stage 1 name/i), { target: { value: "Discovery" } });
    fireEvent.click(screen.getByRole("button", { name: /save pipeline/i }));
    await waitFor(() => expect(op.updatePipeline).toHaveBeenCalled());
    const payload = vi.mocked(op.updatePipeline).mock.calls[0][1];
    expect(payload.stages[0].name).toBe("Discovery");
    // Key is still "qual", NOT re-slugified to "discovery".
    expect(payload.stages[0].key).toBe("qual");
  });

  // GAP-CRM-PIPELINES-05: switching to Edit on another pipeline while the current
  // draft has unsaved edits prompts a discard confirm rather than silently losing them.
  it("warns before discarding an unsaved draft when editing another pipeline", async () => {
    const two: op.Pipeline[] = [
      pipeline,
      { id: "p2", name: "SMB", enabled: true, stages: [{ key: "s1", name: "Lead", mandatoryFields: [], gate: false }] },
    ];
    vi.mocked(op.getPipelines).mockResolvedValue({ data: two, source: "api" });
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    // Edit the first pipeline and make it dirty.
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    fireEvent.change(screen.getByLabelText(/pipeline name/i), { target: { value: "Enterprise CHANGED" } });
    // Now click Edit on the second pipeline -> discard confirm appears.
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[1]);
    expect(await screen.findByText(/discard unsaved changes/i)).toBeInTheDocument();
    // Cancelling keeps the dirty draft intact.
    fireEvent.click(screen.getByRole("button", { name: /keep editing/i }));
    expect((screen.getByLabelText(/pipeline name/i) as HTMLInputElement).value).toBe("Enterprise CHANGED");
  });

  it("does NOT warn when switching editors with no unsaved changes", async () => {
    const two: op.Pipeline[] = [
      pipeline,
      { id: "p2", name: "SMB", enabled: true, stages: [{ key: "s1", name: "Lead", mandatoryFields: [], gate: false }] },
    ];
    vi.mocked(op.getPipelines).mockResolvedValue({ data: two, source: "api" });
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
    // No edits made; switching to the other pipeline must open it directly.
    fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[1]);
    expect(screen.queryByText(/discard unsaved changes/i)).not.toBeInTheDocument();
    expect((screen.getByLabelText(/pipeline name/i) as HTMLInputElement).value).toBe("SMB");
  });

  it("focuses the pipeline name input when an editor opens (GAP-CRM-PIPELINES-05)", async () => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline], source: "api" });
    render(<PipelineEditor />);
    await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    await waitFor(() => expect(screen.getByLabelText(/pipeline name/i)).toHaveFocus());
  });
  // GAP-CRM-PIPELINES-04 (W2 rescan): the Product scope offers the product catalogue, not only
  // values other stages already use. It stays free text (scope matching is exact-string on the
  // server and is not tied to a catalogue id/code), so these are suggestions.
  describe("Product scope suggestions (GAP-CRM-PIPELINES-04)", () => {
    const base = { category: "", unit: "each", taxRateBps: 0, priceMinor: "0", currency: "INR", activeFrom: "", activeTo: "" };
    const catalogue: qp.Product[] = [
      { ...base, id: "pr1", code: "LMS-01", name: "Learning Platform", enabled: true },
      { ...base, id: "pr2", code: "OLD-09", name: "Retired Gadget", enabled: false },
    ];
    const usedElsewhere: op.Pipeline = {
      id: "p9", name: "Other", enabled: true,
      stages: [{ key: "k", name: "Intake", mandatoryFields: [], gate: false, product: "Legacy Suite" }],
    };

    async function openEditor() {
      vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline, usedElsewhere], source: "api" });
      vi.mocked(qp.getProducts).mockResolvedValue({ data: catalogue, source: "api" });
      const { container } = render(<PipelineEditor />);
      await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
      fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
      const input = await screen.findByLabelText(/product scope for stage 1/i);
      return { container, input: input as HTMLInputElement };
    }

    it("lists enabled catalogue products (name, code) plus already-used values; skips retired ones", async () => {
      const { container, input } = await openEditor();
      const listId = input.getAttribute("list")!;
      await waitFor(() => {
        const now = Array.from(container.querySelectorAll(`datalist[id="${listId}"] option`)).map((o) => o.getAttribute("value"));
        expect(now).toContain("Learning Platform");
      });
      const values = Array.from(container.querySelectorAll(`datalist[id="${listId}"] option`)).map((o) => [o.getAttribute("value"), o.textContent]);
      expect(values).toEqual(expect.arrayContaining([["Learning Platform", "LMS-01"], ["Legacy Suite", ""]]));
      expect(values.map((v) => v[0])).not.toContain("Retired Gadget");
    });

    it("still accepts free text (suggestions only) and saves the typed scope", async () => {
      vi.mocked(op.updatePipeline).mockResolvedValue(undefined);
      const { input } = await openEditor();
      fireEvent.change(input, { target: { value: "Learning Platform" } });
      fireEvent.click(screen.getByRole("button", { name: /save pipeline/i }));
      await waitFor(() => expect(op.updatePipeline).toHaveBeenCalled());
      expect(vi.mocked(op.updatePipeline).mock.calls[0][1].stages[0].product).toBe("Learning Platform");
    });

    it("a failed catalogue load degrades to the already-used values without breaking the editor", async () => {
      vi.mocked(op.getPipelines).mockResolvedValue({ data: [pipeline, usedElsewhere], source: "api" });
      vi.mocked(qp.getProducts).mockResolvedValue({ data: [], source: "error" });
      const { container } = render(<PipelineEditor />);
      await waitFor(() => expect(screen.getByText("Enterprise")).toBeInTheDocument());
      fireEvent.click(screen.getAllByRole("button", { name: /^edit$/i })[0]);
      const input = await screen.findByLabelText(/product scope for stage 1/i);
      const listId = input.getAttribute("list")!;
      const values = Array.from(container.querySelectorAll(`datalist[id="${listId}"] option`)).map((o) => o.getAttribute("value"));
      expect(values).toEqual(["Legacy Suite"]);
    });
  });
});
