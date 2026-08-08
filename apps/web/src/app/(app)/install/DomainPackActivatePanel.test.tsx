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
  vi.mocked(api.activateDomainPackStage3).mockReset();
  vi.mocked(api.fetchDomainPacksForInstall).mockResolvedValue(municipalList);
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
});
