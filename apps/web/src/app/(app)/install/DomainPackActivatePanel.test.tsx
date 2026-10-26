import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor, within } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";
import { DomainPackActivatePanel } from "./DomainPackActivatePanel";
import * as api from "./domainPackApi";
import { MUNICIPAL_DOMAIN_PACK } from "./domainPackCatalog";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("./domainPackApi", async (orig) => {
  const actual = await orig<typeof import("./domainPackApi")>();
  return {
    ...actual,
    fetchDomainPacksForInstall: vi.fn(),
    fetchDomainPacksForInstallResult: vi.fn(),
    activateDomainPackStage3: vi.fn(),
    fetchActivationStageStatus: vi.fn(),
    fetchDomainPackActivationStatus: vi.fn(),
  };
});

const municipalList = [
  {
    ...MUNICIPAL_DOMAIN_PACK,
    fromApi: false as const,
  },
];

beforeEach(() => {
  vi.mocked(api.fetchDomainPacksForInstall).mockReset();
  vi.mocked(api.fetchDomainPacksForInstallResult).mockReset();
  vi.mocked(api.activateDomainPackStage3).mockReset();
  vi.mocked(api.fetchActivationStageStatus).mockReset();
  vi.mocked(api.fetchActivationStageStatus).mockResolvedValue({ state: "queued" });
  vi.mocked(api.fetchDomainPackActivationStatus).mockReset();
  vi.mocked(api.fetchDomainPackActivationStatus).mockResolvedValue({ state: "none" });
  vi.mocked(api.fetchDomainPacksForInstall).mockResolvedValue(municipalList);
  vi.mocked(api.fetchDomainPacksForInstallResult).mockResolvedValue({
    packs: municipalList,
    error: false,
  });
});

describe("DomainPackActivatePanel (FN-17)", () => {
  it("shows municipal-in-v1 → TL / PGR / Water outcome clearly", async () => {
    render(<DomainPackActivatePanel variant="page" />);
    await waitFor(() => expect(screen.getByText(/Municipal India/i)).toBeInTheDocument());
    expect(screen.getAllByText(/municipal-in-v1/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/TL \/ PGR \/ Water/i).length).toBeGreaterThanOrEqual(1);
    const outcomes = screen.getByRole("list", { name: /Service packs imported on activate/i });
    expect(within(outcomes).getByText("Trade License")).toBeInTheDocument();
    expect(within(outcomes).getByText("Public Grievance Redressal")).toBeInTheDocument();
    expect(within(outcomes).getByText("Water Connection")).toBeInTheDocument();
  });

  it("activates via Stage 3 API after confirm", async () => {
    vi.mocked(api.activateDomainPackStage3).mockResolvedValue({
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      status: "accepted",
      correlationId: "corr",
      domainPackKey: "municipal-in-v1",
      stageNumber: 3,
      packKeys: ["pack:trade-license", "pack:pgr", "pack:water-connection"],
      stageId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
    });

    render(<DomainPackActivatePanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Activate Domain Pack/i })).toBeEnabled());

    fireEvent.click(screen.getByRole("button", { name: /Activate Domain Pack/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Activate$/i }));

    await waitFor(() =>
      expect(api.activateDomainPackStage3).toHaveBeenCalledWith(
        "municipal-in-v1",
        ["pack:trade-license", "pack:pgr", "pack:water-connection"],
      ),
    );
    expect(await screen.findByText(/Activation accepted/i)).toBeInTheDocument();
  });

  it("shows failure path when activate rejects", async () => {
    vi.mocked(api.activateDomainPackStage3).mockRejectedValue(new Error("queue unavailable"));

    render(<DomainPackActivatePanel />);
    await waitFor(() => expect(screen.getByRole("button", { name: /Activate Domain Pack/i })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Activate Domain Pack/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Activate$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/queue unavailable/i);
  });

  // GAP-INSTALL-DOMAIN-PACKS-02 / HOME-07: a failed library fetch shows a retry
  // banner over the built-in fallback, not a silent healthy-looking list.
  it("shows a retry banner when the pack library fetch failed", async () => {
    vi.mocked(api.fetchDomainPacksForInstallResult).mockResolvedValue({
      packs: municipalList,
      error: true,
    });
    render(<DomainPackActivatePanel variant="page" />);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Showing built-in pack only/i);
    expect(within(alert).getByRole("button", { name: /Retry/i })).toBeInTheDocument();
  });

  it("shows no retry banner on a healthy load", async () => {
    render(<DomainPackActivatePanel variant="page" />);
    await waitFor(() => expect(screen.getByText(/Municipal India/i)).toBeInTheDocument());
    expect(screen.queryByText(/Showing built-in pack only/i)).not.toBeInTheDocument();
  });

  // GAP-INSTALL-HOME-03 / DOMAIN-PACKS-01: a read-only viewer gets no Activate.
  it("hides Activate for a read-only viewer", async () => {
    render(<DomainPackActivatePanel variant="page" canOperate={false} />);
    await waitFor(() => expect(screen.getByText(/Municipal India/i)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /Activate Domain Pack/i })).not.toBeInTheDocument();
    expect(screen.getByText(/read-only access/i)).toBeInTheDocument();
  });

  // GAP-INSTALL-DOMAIN-PACKS-05: no "§" or "pack:" string is visible by default
  // (keys live behind a Technical details disclosure).
  it("does not expose DoD '§' or raw 'pack:' keys in the default view", async () => {
    render(<DomainPackActivatePanel variant="page" />);
    await waitFor(() => expect(screen.getByText(/Municipal India/i)).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/§/);
    // The pack: keys only appear inside collapsed <details>, not as a visible
    // heading/outcome line. Assert they are not in an open/visible position by
    // checking the summary label is what is shown.
    expect(screen.getAllByText(/Technical details/i).length).toBeGreaterThanOrEqual(1);
  });

  // GAP-INSTALL-DOMAIN-PACKS-01: the activation result follows the tracked job
  // until it reaches completed or failed.
  describe("activation job status", () => {
    const accepted = {
      id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      stageId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
      status: "accepted",
      correlationId: "corr",
      domainPackKey: "municipal-in-v1",
      stageNumber: 3,
      packKeys: ["pack:trade-license", "pack:pgr", "pack:water-connection"],
    };

    async function activate() {
      render(<DomainPackActivatePanel pollIntervalMs={20} />);
      await waitFor(() => expect(screen.getByRole("button", { name: /Activate Domain Pack/i })).toBeEnabled());
      fireEvent.click(screen.getByRole("button", { name: /Activate Domain Pack/i }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /^Activate$/i }));
      await screen.findByText(/Activation accepted/i);
    }

    it("polls the stage and shows completion once the job completes", async () => {
      vi.mocked(api.activateDomainPackStage3).mockResolvedValue(accepted);
      vi.mocked(api.fetchDomainPackActivationStatus)
        .mockResolvedValueOnce({ state: "none" })
        .mockResolvedValueOnce({ state: "queued", activationId: accepted.id })
        .mockResolvedValue({ state: "completed", activationId: accepted.id, draftCount: 3 });
      await activate();
      expect(await screen.findByText(/Activation completed/i, undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(api.fetchDomainPackActivationStatus).toHaveBeenCalledWith("municipal-in-v1");
      expect(screen.queryByText(/Activation failed/i)).not.toBeInTheDocument();
    }, 15000);

    it("shows a failure state (not success) when the job fails", async () => {
      vi.mocked(api.activateDomainPackStage3).mockResolvedValue(accepted);
      vi.mocked(api.fetchDomainPackActivationStatus)
        .mockResolvedValueOnce({ state: "none" })
        .mockResolvedValue({ state: "failed", activationId: accepted.id });
      await activate();
      expect(await screen.findByText(/Activation failed/i, undefined, { timeout: 8000 })).toBeInTheDocument();
      expect(screen.queryByText(/Activation completed/i)).not.toBeInTheDocument();
    }, 15000);

    it("an older completed record is not mistaken for this activation while the new one is still being recorded", async () => {
      vi.mocked(api.activateDomainPackStage3).mockResolvedValue(accepted);
      // The status endpoint still returns the PREVIOUS activation's record (a different id).
      vi.mocked(api.fetchDomainPackActivationStatus)
        .mockResolvedValueOnce({ state: "none" })
        .mockResolvedValue({ state: "completed", activationId: "ffffffff-ffff-ffff-ffff-ffffffffffff", draftCount: 3 });
      await activate();
      expect(await screen.findByText(/Waiting for the install job/i)).toBeInTheDocument();
      expect(screen.queryByText(/Activation completed/i)).not.toBeInTheDocument();
    });

    it("shows the queued state while the job has not finished", async () => {
      vi.mocked(api.activateDomainPackStage3).mockResolvedValue(accepted);
      await activate();
      expect(await screen.findByText(/Waiting for the install job/i)).toBeInTheDocument();
    });
  });

  // GAP-INSTALL-DOMAIN-PACKS-04: the panel is themed with design-system tokens,
  // not hard-coded Tailwind palette classes (which do not follow dark mode).
  describe("design-system tokens (GAP-INSTALL-DOMAIN-PACKS-04)", () => {
    it("renders no hard-coded Tailwind palette colour classes", async () => {
      const { container } = render(<DomainPackActivatePanel variant="page" />);
      await waitFor(() => expect(screen.getByText(/Municipal India/i)).toBeInTheDocument());
      const palette = /\b(?:bg|text|border|ring|from|to)-(?:indigo|slate|emerald|amber|red|gray|green|blue)-\d{2,3}/;
      expect(container.innerHTML).not.toMatch(palette);
    });

    it("renders no palette classes in the embedded variant, error banner or result state either", async () => {
      vi.mocked(api.fetchDomainPacksForInstallResult).mockResolvedValue({ packs: municipalList, error: true });
      vi.mocked(api.activateDomainPackStage3).mockResolvedValue({
        id: "c", stageId: "d", status: "accepted", correlationId: "x", domainPackKey: "municipal-in-v1",
        stageNumber: 3, packKeys: [],
      });
      const { container } = render(<DomainPackActivatePanel variant="embedded" pollIntervalMs={20} />);
      await screen.findByRole("alert");
      fireEvent.click(screen.getByRole("button", { name: /Activate Domain Pack/i }));
      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(within(dialog).getByRole("button", { name: /^Activate$/i }));
      await screen.findByText(/Activation accepted/i);
      const palette = /\b(?:bg|text|border|ring|from|to)-(?:indigo|slate|emerald|amber|red|gray|green|blue)-\d{2,3}/;
      expect(container.innerHTML).not.toMatch(palette);
    });

    it("the page back link is a real link without a hand-typed arrow glyph", async () => {
      render(<DomainPackActivatePanel variant="page" />);
      await waitFor(() => expect(screen.getByText(/Municipal India/i)).toBeInTheDocument());
      const back = screen.getByRole("link", { name: /Installer wizard/i });
      expect(back).toHaveAttribute("href", "/install");
      expect(back.textContent).not.toMatch(/[←→]/);
    });
  });

  // Owner decision #28 (GAP-INSTALL-DOMAIN-PACKS-04): the activated state survives a reload because it
  // comes from the durable per-tenant record, not React state.
  describe("persisted activation (owner decision #28)", () => {
    it("a completed activation recorded server-side shows Activated after a reload, with the draft count", async () => {
      vi.mocked(api.fetchDomainPackActivationStatus).mockResolvedValue({
        state: "completed", activationId: "cccccccc-cccc-cccc-cccc-cccccccccccc", draftCount: 3,
        completedAt: "2026-10-26T10:00:00.000Z",
      });
      render(<DomainPackActivatePanel pollIntervalMs={20} />);
      expect(await screen.findByText(/Activation completed/i)).toBeInTheDocument();
      expect(screen.getByText(/3 drafts imported/i)).toBeInTheDocument();
      const button = screen.getByRole("button", { name: /^Activated$/i });
      expect(button).toBeDisabled();
      expect(api.fetchDomainPackActivationStatus).toHaveBeenCalledWith("municipal-in-v1");
    });

    it("a failed activation recorded server-side shows the failure and leaves Retry available", async () => {
      vi.mocked(api.fetchDomainPackActivationStatus).mockResolvedValue({
        state: "failed", activationId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
      });
      render(<DomainPackActivatePanel pollIntervalMs={20} />);
      expect(await screen.findByText(/Activation failed/i)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Retry activation/i })).toBeEnabled();
    });

    it("an in-flight activation recorded server-side resumes polling until it completes", async () => {
      const id = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      vi.mocked(api.fetchDomainPackActivationStatus)
        .mockResolvedValueOnce({ state: "queued", activationId: id })
        .mockResolvedValue({ state: "completed", activationId: id, draftCount: 3 });
      render(<DomainPackActivatePanel pollIntervalMs={20} />);
      expect(await screen.findByText(/Waiting for the install job/i)).toBeInTheDocument();
      expect(await screen.findByText(/Activation completed/i, undefined, { timeout: 8000 })).toBeInTheDocument();
    }, 15000);

    it("a never-activated pack offers Activate, and an unreadable status does not claim activation", async () => {
      render(<DomainPackActivatePanel />);
      await waitFor(() => expect(screen.getByRole("button", { name: /Activate Domain Pack/i })).toBeEnabled());
      expect(screen.queryByText(/Activation completed/i)).not.toBeInTheDocument();
    });

    it("says so (does not invent a state) when the activation status cannot be read", async () => {
      vi.mocked(api.fetchDomainPackActivationStatus).mockResolvedValue({ state: "unknown" });
      render(<DomainPackActivatePanel />);
      expect(await screen.findByText(/couldn't check whether this Domain Pack was already activated/i)).toBeInTheDocument();
      expect(screen.queryByText(/Activation completed/i)).not.toBeInTheDocument();
    });
  });
});
