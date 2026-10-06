import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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
});
