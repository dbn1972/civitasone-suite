import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));

import { useSeededResource } from "@/lib/sync/resource";
import { EmdBgTable } from "./EmdBgTable";
import type { EmdBgEntry } from "../../../_data/loaders";

const mockedHook = vi.mocked(useSeededResource);

type Prov = "live" | "cached" | "error-no-data";

/**
 * EmdBgTable calls useSeededResource twice: first for "procurement.emd", then
 * "procurement.pbg". Route each call by its cache key.
 */
function seed(opts: {
  emd: { data: EmdBgEntry[]; provenance: Prov };
  pbg: { data: EmdBgEntry[]; provenance: Prov };
}) {
  mockedHook.mockImplementation(((key: string) => {
    const which = key === "procurement.emd" ? opts.emd : opts.pbg;
    return {
      data: which.data,
      provenance: which.provenance,
      offline: false,
      cachedAt: which.provenance === "cached" ? "2026-10-01T00:00:00.000Z" : null,
      fromCache: which.provenance === "cached",
    } as unknown as ReturnType<typeof useSeededResource>;
  }) as unknown as typeof useSeededResource);
}

// A date comfortably in the future so the expiry cue is deterministic-ish; we
// assert the "Expires in"/"Expired" wording, not an exact day count.
const FUTURE = "2999-01-01";
const PAST = "2000-01-01";

const EMD: EmdBgEntry[] = [
  { id: "e1", vendor: "Alpha Co", type: "EMD", amount: 125050, validity: FUTURE, bank: "SBI", status: "Active" },
  { id: "e2", vendor: "Beta Co", type: "EMD", amount: 500000, validity: PAST, bank: "HDFC", status: "Active" },
];
const PBG: EmdBgEntry[] = [
  { id: "p1", vendor: "Gamma Co", type: "BG", amount: 1000000, validity: FUTURE, bank: "ICICI", status: "Active" },
];

describe("EmdBgTable", () => {
  beforeEach(() => mockedHook.mockReset());

  // GAP-PROCUREMENT-EMD-BG-02: an EMD is NOT a guarantee — counts must be split.
  it("counts Active Bank Guarantees and Active EMD separately", () => {
    seed({ emd: { data: EMD, provenance: "live" }, pbg: { data: PBG, provenance: "live" } });
    render(<EmdBgTable emdEntries={EMD} pbgEntries={PBG} emdSource="api" pbgSource="api" />);
    expect(screen.getByText("Active Bank Guarantees").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Active EMD").closest(".stat")).toHaveTextContent("2");
  });

  // GAP-PROCUREMENT-EMD-BG-03: formatMoney — 125050 paise -> ₹1,250.50 (not ₹1,250.5).
  it("formats amounts with formatMoney (trailing paise zeros preserved)", () => {
    seed({ emd: { data: EMD, provenance: "live" }, pbg: { data: PBG, provenance: "live" } });
    render(<EmdBgTable emdEntries={EMD} pbgEntries={PBG} emdSource="api" pbgSource="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("₹1,250.50")).toBeInTheDocument();
    expect(within(table).queryByText("₹1,250.5")).not.toBeInTheDocument();
    // Combined active total = 125050 + 500000 + 1000000 = 1625050 paise = ₹16,250.50
    expect(screen.getByText("Total Active Security (EMD + BG)").closest(".stat")).toHaveTextContent("₹16,250.50");
  });

  // GAP-PROCUREMENT-EMD-BG-05: expiry cue computed from the date, dd Mon yyyy.
  it("renders an expiry cue and dd Mon yyyy validity", () => {
    seed({ emd: { data: EMD, provenance: "live" }, pbg: { data: PBG, provenance: "live" } });
    render(<EmdBgTable emdEntries={EMD} pbgEntries={PBG} emdSource="api" pbgSource="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByText(/Expires in/).length).toBeGreaterThan(0);
    expect(within(table).getAllByText(/Expired/).length).toBeGreaterThan(0);
    expect(within(table).getByText("01 Jan 2000")).toBeInTheDocument();
  });

  // GAP-PROCUREMENT-EMD-BG-01: EMD ok + PBG errored -> EMD rows visible, a
  // banner naming the BG failure, stats "—" (never a complete-looking total),
  // and NO "showing nothing" while EMD rows are on screen.
  it("on a partial failure (BG errored), shows EMD rows + a named BG error, with '—' stats", () => {
    seed({ emd: { data: EMD, provenance: "live" }, pbg: { data: [], provenance: "error-no-data" } });
    render(<EmdBgTable emdEntries={EMD} pbgEntries={[]} emdSource="api" pbgSource="error" />);

    // EMD rows still shown.
    const table = screen.getByRole("table");
    expect(within(table).getByText("Alpha Co")).toBeInTheDocument();
    // A banner that names the failed register.
    expect(screen.getByText(/couldn't load bank guarantees/i)).toBeInTheDocument();
    // Stats that depend on the missing register read "—", not a fabricated 0.
    expect(screen.getByText("Active Bank Guarantees").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Total Active Security (EMD + BG)").closest(".stat")).toHaveTextContent("—");
    // Never "showing nothing" while EMD rows are visible.
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
  });

  // GAP-PROCUREMENT-EMD-BG-01: both healthy -> unchanged, full combined stats.
  it("with both registers healthy, shows combined stats and all rows", () => {
    seed({ emd: { data: EMD, provenance: "live" }, pbg: { data: PBG, provenance: "live" } });
    render(<EmdBgTable emdEntries={EMD} pbgEntries={PBG} emdSource="api" pbgSource="api" />);
    const table = screen.getByRole("table");
    expect(within(table).getByText("Alpha Co")).toBeInTheDocument();
    expect(within(table).getByText("Gamma Co")).toBeInTheDocument();
    expect(screen.queryByText(/showing nothing/i)).not.toBeInTheDocument();
  });
});
