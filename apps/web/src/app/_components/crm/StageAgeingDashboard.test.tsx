import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen, fireEvent, waitFor } from "@testing-library/react";
import { StageAgeingDashboard } from "./StageAgeingDashboard";
import * as op from "@/lib/crm/opportunity";
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
  return {
    ...actual,
    getStageAgeing: vi.fn(),
    getStageLimits: vi.fn(),
    getPipelines: vi.fn(),
    createStageLimit: vi.fn(),
    updateStageLimit: vi.fn(),
    deleteStageLimit: vi.fn(),
  };
});

const PIPELINE: op.Pipeline = {
  id: "p1",
  name: "Enterprise",
  enabled: true,
  stages: [
    { key: "qual", name: "Qualify", mandatoryFields: [], gate: false },
    { key: "propose", name: "Propose", mandatoryFields: [], gate: false },
  ],
};

beforeEach(() => {
  vi.mocked(op.getStageAgeing).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(op.getStageLimits).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(op.getPipelines).mockReset().mockResolvedValue({ data: [PIPELINE], source: "api" });
  vi.mocked(op.createStageLimit).mockReset();
  vi.mocked(op.updateStageLimit).mockReset();
  vi.mocked(op.deleteStageLimit).mockReset();
});

describe("StageAgeingDashboard (OP-005)", () => {
  it("lists opportunities exceeding their stage limit, worst first", async () => {
    vi.mocked(op.getStageAgeing).mockResolvedValue({
      data: [
        { id: "d1", name: "Slow deal", stage: "qual", stageName: "Qualify", daysInStage: 30, limitDays: 14, exceededBy: 16 },
        { id: "d2", name: "Slower deal", stage: "propose", stageName: "Propose", daysInStage: 60, limitDays: 20, exceededBy: 40 },
      ],
      source: "api",
    });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText("Slow deal")).toBeInTheDocument());
    const rows = screen.getAllByRole("row").filter((r) => /deal/i.test(r.textContent ?? ""));
    // worst (over by 40) should sort above (over by 16)
    expect(rows[0].textContent).toMatch(/Slower deal/);
  });

  it("gates the ageing table on a failed fetch", async () => {
    vi.mocked(op.getStageAgeing).mockResolvedValue({ data: [], source: "error" });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getAllByText(/couldn.t load/i).length).toBeGreaterThan(0));
  });

  it("creates a stage limit from the pipeline's stage list", async () => {
    vi.mocked(op.createStageLimit).mockResolvedValue(undefined);
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText(/no stage limits yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add stage limit/i }));
    // The new row defaults to the first pipeline; pick one of ITS stages. The limit is keyed by the
    // stage NAME (what deals.stage stores), not the web-derived slug key ("qual").
    fireEvent.change(screen.getByLabelText(/stage for limit 1/i), { target: { value: "Qualify" } });
    fireEvent.change(screen.getByLabelText(/days limit for 1/i), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(op.createStageLimit).toHaveBeenCalledWith(expect.objectContaining({ pipelineId: "p1", stage: "Qualify", maxDays: 14, enabled: true })));
  });

  it("blocks a zero-day limit", async () => {
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText(/no stage limits yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add stage limit/i }));
    fireEvent.change(screen.getByLabelText(/stage for limit 1/i), { target: { value: "Qualify" } });
    fireEvent.change(screen.getByLabelText(/days limit for 1/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument();
    expect(op.createStageLimit).not.toHaveBeenCalled();
  });

  // GAP-CRM-OPPORTUNITY-AGEING-01: the stage is now constrained to the chosen pipeline's
  // configured stages — there is no free-text input to typo into a dead key, and the
  // stage <select> only offers that pipeline's stages.
  it("offers only the selected pipeline's stages, never a free-text key", async () => {
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText(/no stage limits yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add stage limit/i }));
    const stageSelect = screen.getByLabelText(/stage for limit 1/i);
    expect(stageSelect.tagName).toBe("SELECT");
    const labels = Array.from((stageSelect as HTMLSelectElement).options).map((o) => o.textContent);
    expect(labels).toContain("Qualify");
    expect(labels).toContain("Propose");
    // No way to submit a stage not in the pipeline: a blank stage is blocked.
    fireEvent.change(screen.getByLabelText(/days limit for 1/i), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/one of that pipeline's stages/i)).toBeInTheDocument();
    expect(op.createStageLimit).not.toHaveBeenCalled();
  });

  // A saved limit whose stage key is no longer in its pipeline is flagged as an orphan,
  // stays visible, and blocks Save until corrected — but can still be deleted.
  it("flags a saved limit whose stage is not in its pipeline as an orphan", async () => {
    vi.mocked(op.getStageLimits).mockResolvedValue({
      data: [{ id: "l1", pipelineId: "p1", stage: "proposel", maxDays: 14, enabled: true }],
      source: "api",
    });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText(/not in the selected pipeline/i)).toBeInTheDocument());
    // The orphan key is still shown (as a disabled option) so it can be seen/removed.
    expect(screen.getByText(/proposel — not in pipeline/i)).toBeInTheDocument();
    // Saving the orphan as-is is blocked.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/one of that pipeline's stages/i)).toBeInTheDocument();
    expect(op.updateStageLimit).not.toHaveBeenCalled();
  });

  // GAP-CRM-OPPORTUNITY-AGEING-02: a limit can be paused. Unticking Enabled and
  // saving sends enabled:false in the PUT body (no silent re-enable).
  it("sends enabled:false when the Enabled toggle is unticked and saved", async () => {
    vi.mocked(op.updateStageLimit).mockResolvedValue(undefined);
    vi.mocked(op.getStageLimits).mockResolvedValue({
      data: [{ id: "l1", pipelineId: "p1", stage: "Qualify", maxDays: 14, enabled: true }],
      source: "api",
    });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByLabelText(/enabled for limit 1/i)).toBeInTheDocument());
    const toggle = screen.getByLabelText(/enabled for limit 1/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(op.updateStageLimit).toHaveBeenCalledWith("l1", expect.objectContaining({ enabled: false })),
    );
  });

  // GAP-CRM-OPPORTUNITY-AGEING-03: a breach links to its record and shows the owner.
  it("links the breach name to the deal record and shows an Owner column", async () => {
    vi.mocked(op.getStageAgeing).mockResolvedValue({
      data: [{ id: "d1", name: "Slow deal", stage: "qual", stageName: "Qualify", daysInStage: 30, limitDays: 14, exceededBy: 16, ownerName: "Asha Rao" }],
      source: "api",
    });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText("Slow deal")).toBeInTheDocument());
    const link = screen.getByRole("link", { name: "Slow deal" });
    expect(link).toHaveAttribute("href", "/crm/deals/d1");
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });

  // GAP-CRM-OPPORTUNITY-AGEING-04: the error state has a Retry that re-fetches and
  // never claims "saved information".
  it("shows a Retry on a failed ageing load that re-fetches", async () => {
    vi.mocked(op.getStageAgeing)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValue({ data: [{ id: "d1", name: "Recovered deal", stage: "qual", stageName: "Qualify", daysInStage: 30, limitDays: 14, exceededBy: 16 }], source: "api" });
    render(<StageAgeingDashboard />);
    const retry = await screen.findByRole("button", { name: /retry/i });
    expect(screen.queryByText(/showing saved information/i)).not.toBeInTheDocument();
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getByText("Recovered deal")).toBeInTheDocument());
  });

  // GAP-CRM-OPPORTUNITY-AGEING-05: a non-admin (canConfig=false) sees the ageing
  // list but no limits config (Save/Delete).
  it("hides the limits config card for a non-admin (canConfig=false)", async () => {
    vi.mocked(op.getStageAgeing).mockResolvedValue({
      data: [{ id: "d1", name: "Slow deal", stage: "qual", stageName: "Qualify", daysInStage: 30, limitDays: 14, exceededBy: 16 }],
      source: "api",
    });
    render(<StageAgeingDashboard canConfig={false} />);
    await waitFor(() => expect(screen.getByText("Slow deal")).toBeInTheDocument());
    expect(screen.queryByText(/stage day limits/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add stage limit/i })).not.toBeInTheDocument();
    // The limits endpoint is not even called for a non-admin.
    expect(op.getStageLimits).not.toHaveBeenCalled();
  });
});

// GAP-CRM-OPPORTUNITY-AGEING-01 (W2 crm cluster 07): a limit matches deals by the stage NAME
// (crm-service stores deals.stage as the name and joins sl.stage = d.stage exactly), so the
// dashboard must offer, validate and save the NAME - never the web-derived slug key.
describe("StageAgeingDashboard stage NAME keying (GAP-CRM-OPPORTUNITY-AGEING-01)", () => {
  const MIXED: op.Pipeline = {
    id: "p2",
    name: "Field Services",
    enabled: true,
    stages: [
      { key: "intake", name: "Intake", mandatoryFields: [], gate: false },
      { key: "site_visit_scheduled", name: "Site Visit Scheduled", mandatoryFields: [], gate: false },
    ],
  };
  beforeEach(() => {
    vi.mocked(op.getPipelines).mockResolvedValue({ data: [PIPELINE, MIXED], source: "api" });
  });

  it("saves 'Site Visit Scheduled' - the exact stage name deals carry - not the slug 'site_visit_scheduled'", async () => {
    vi.mocked(op.createStageLimit).mockResolvedValue(undefined);
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText(/no stage limits yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add stage limit/i }));
    fireEvent.change(screen.getByLabelText(/pipeline for limit 1/i), { target: { value: "p2" } });
    const stageSelect = screen.getByLabelText(/stage for limit 1/i) as HTMLSelectElement;
    expect(Array.from(stageSelect.options).map((o) => o.value).filter(Boolean)).toEqual(["Intake", "Site Visit Scheduled"]);
    fireEvent.change(stageSelect, { target: { value: "Site Visit Scheduled" } });
    fireEvent.change(screen.getByLabelText(/days limit for 1/i), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    await waitFor(() => expect(op.createStageLimit).toHaveBeenCalledTimes(1));
    const body = vi.mocked(op.createStageLimit).mock.calls[0]![0];
    expect(body.stage).toBe("Site Visit Scheduled");
    expect(body.stage).not.toBe("site_visit_scheduled");
  });

  it("treats a saved limit stored under the old slug key as an orphan and says which stage to re-pick", async () => {
    vi.mocked(op.getStageLimits).mockResolvedValue({
      data: [{ id: "l9", pipelineId: "p2", stage: "site_visit_scheduled", maxDays: 7, enabled: true }],
      source: "api",
    });
    render(<StageAgeingDashboard />);
    const alert = await screen.findByText(/saved under the key “site_visit_scheduled”, which matches no deal/i);
    expect(alert).toHaveTextContent(/Choose the stage “Site Visit Scheduled” again/);
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.getByLabelText(/stage for limit 1/i)).toHaveAttribute("aria-invalid", "true");
    // It cannot be saved as-is: the dead key would just be re-sent.
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(await screen.findByText(/one of that pipeline's stages/i)).toBeInTheDocument();
    expect(op.updateStageLimit).not.toHaveBeenCalled();
  });

  it("does not show a blank stage for a legacy limit with no pipeline: it is listed, and flagged when it matches no pipeline stage", async () => {
    vi.mocked(op.getStageLimits).mockResolvedValue({
      data: [
        { id: "g1", stage: "Intake", maxDays: 10, enabled: true }, // real stage name in some pipeline
        { id: "g2", stage: "proposel", maxDays: 10, enabled: true }, // matches nothing anywhere
      ],
      source: "api",
    });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByLabelText(/stage for limit 1/i)).toBeInTheDocument());
    const first = screen.getByLabelText(/stage for limit 1/i) as HTMLSelectElement;
    expect(first.value).toBe("Intake");
    expect(screen.getByText(/Intake — applies to all pipelines/i)).toBeInTheDocument();
    expect(screen.getByText(/applies to every pipeline/i)).toBeInTheDocument();
    // The second one matches no stage in any pipeline: flagged as an orphan, not silently "fine".
    const second = screen.getByLabelText(/stage for limit 2/i) as HTMLSelectElement;
    expect(second.value).toBe("proposel");
    expect(second).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(/not in the selected pipeline/i)).toBeInTheDocument();
  });
});
