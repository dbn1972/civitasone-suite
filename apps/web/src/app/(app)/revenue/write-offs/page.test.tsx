import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import WriteOffsPage from "./page";

const ASSESSEE = {
  id: "11111111-1111-1111-1111-111111111111",
  ownerName: "Ravi Kumar",
  identifierNo: "PMC-0001",
  assesseeType: "residential",
};

function route(opts: {
  assessees?: { data: unknown; source?: string };
  dcb?: { data: unknown; source?: string };
  pending?: { data: unknown; source?: string };
  demands?: { data: unknown; source?: string };
}) {
  // Apply the loader's own mapResponse to the raw payload, so the mock exercises
  // the real mapping (amountMinor → amountLabel, etc.) exactly as production.
  fetchJsonMock.mockImplementation(
    (_url: string, fallback: unknown, cfg: { telemetryKey?: string; mapResponse?: (p: unknown) => unknown }) => {
      const key = cfg?.telemetryKey ?? "";
      const pick = () => {
        if (key.includes("write-offs.assessees")) return opts.assessees ?? { data: [ASSESSEE], source: "api" };
        if (key.includes("write-offs.dcb"))
          return opts.dcb ?? { data: { balance: "150000", totalDemand: "200000", totalCollected: "50000" }, source: "api" };
        if (key.includes("write-offs.demands")) return opts.demands ?? { data: [], source: "api" };
        if (key.includes("write-offs.pending")) return opts.pending ?? { data: [], source: "api" };
        return { data: [], source: "api" };
      };
      const result = pick() as { data: unknown; source?: string };
      if (result.source === "error") return Promise.resolve({ data: fallback, source: "error" });
      const mapped = cfg?.mapResponse ? cfg.mapResponse({ data: result.data }) : result.data;
      return Promise.resolve({ data: mapped ?? fallback, source: result.source ?? "api" });
    },
  );
}

describe("WriteOffsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts for an assessee when none is selected", async () => {
    route({});
    const ui = await WriteOffsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders the write-off form once an assessee is selected", async () => {
    route({});
    const ui = await WriteOffsPage({ searchParams: { assesseeId: ASSESSEE.id } });
    render(ui);
    expect(screen.getByRole("heading", { name: "Raise Write-off" })).toBeInTheDocument();
  });

  it("shows the data-source badge instead of fabricating data on assessee load error", async () => {
    route({ assessees: { data: [], source: "error" } });
    const ui = await WriteOffsPage({ searchParams: {} });
    render(ui);
    expect(screen.getAllByText("Couldn't load — showing nothing").length).toBeGreaterThan(0);
  });

  it("no longer shows developer 'BACKEND FOLLOW-UPS' text to end users (GAP-REVENUE-WRITE-OFFS-04)", async () => {
    route({});
    const ui = await WriteOffsPage({ searchParams: {} });
    render(ui);
    expect(screen.queryByText(/BACKEND FOLLOW-UPS/)).not.toBeInTheDocument();
    expect(screen.queryByText(/does not yet expose a list endpoint/)).not.toBeInTheDocument();
  });

  it("lists pending write-offs for the checker to discover and open (GAP-REVENUE-WRITE-OFFS-02)", async () => {
    route({
      pending: {
        data: [
          { id: "wo-1", assesseeId: ASSESSEE.id, amountMinor: "100000", reason: "Irrecoverable", status: "pending" },
        ],
        source: "api",
      },
    });
    const ui = await WriteOffsPage({ searchParams: {} });
    render(ui);
    expect(screen.getByText("Pending write-offs")).toBeInTheDocument();
    expect(screen.getByText("₹1,000.00")).toBeInTheDocument();
    expect(screen.getByText("Irrecoverable")).toBeInTheDocument();
  });

  it("shows a retry state (not an empty 'none pending') when the pending list fails to load (GAP-REVENUE-WRITE-OFFS-02)", async () => {
    route({ pending: { data: [], source: "error" } });
    const ui = await WriteOffsPage({ searchParams: {} });
    render(ui);
    expect(screen.queryByText("No pending write-offs")).not.toBeInTheDocument();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });
});
