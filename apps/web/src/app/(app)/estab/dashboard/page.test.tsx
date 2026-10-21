import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";

const getEstabDashboard = vi.fn();
const getEstabFiles = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getEstabDashboard: (...a: unknown[]) => getEstabDashboard(...a),
  getEstabFiles: (...a: unknown[]) => getEstabFiles(...a),
}));

import EstabDashboardPage from "./page";

const DASH = {
  filesPending: 12,
  meetingsToday: 2,
  vehiclesInUse: 3,
  complianceItemsDue: 5,
  slaBreached: 1,
  dakPending: 4,
  avgPendencyDays: 7,
  openFiles: 14,
  oldestPendencyDays: 42,
};

function fileRow(n: number, createdDate: string) {
  return {
    id: `f${n}`, fileNo: `F/${String(n).padStart(3, "0")}`, subject: `Subject ${n}`, status: "active" as const,
    createdDate, dueDate: "2026-12-01", classification: "unclassified" as const, createdBy: "u1", tags: [],
  };
}

/** The F/nnn file numbers in the order they appear in the "Recent files" table. */
function recentFileNos(): string[] {
  const card = screen.getByRole("heading", { name: /Recent files/i }).closest(".card") as HTMLElement;
  return Array.from(card.querySelectorAll("tbody tr")).map((tr) => /F\/\d{3}/.exec(tr.textContent ?? "")?.[0] ?? "");
}

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-05", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("shows the vehiclesInUse figure in the pendency snapshot and does not duplicate the Avg Pendency tile there", async () => {
    // (extended below: the snapshot repeats NONE of the stat tiles)
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });

    const ui = await EstabDashboardPage();
    render(ui);

    // The snapshot panel surfaces vehiclesInUse (previously loaded but never shown).
    const heading = screen.getByRole("heading", { name: /Pendency snapshot/i });
    const panel = heading.closest(".card") as HTMLElement;
    expect(within(panel).getByText(/Vehicles in use/i)).toBeInTheDocument();
    expect(within(panel).getByText("3")).toBeInTheDocument();

    // The snapshot no longer repeats the "Avg pendency" field (it lives in the stat tiles).
    expect(within(panel).queryByText(/Avg pendency/i)).not.toBeInTheDocument();

    // The Avg Pendency stat tile still exists at the top.
    expect(screen.getByText(/Avg Pendency \(days\)/i)).toBeInTheDocument();
  });

  it("repeats none of the stat tiles: no Active files / Unlinked DAK / SLA breached / Avg pendency row, only figures the tiles do not show", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });
    render(await EstabDashboardPage());

    const panel = screen.getByRole("heading", { name: /Pendency snapshot/i }).closest(".card") as HTMLElement;
    for (const echoed of [/Active files/i, /Unlinked DAK/i, /SLA breached/i, /Avg pendency/i]) {
      expect(within(panel).queryByText(echoed)).not.toBeInTheDocument();
    }
    // What it shows instead, each with its own value.
    const row = (label: RegExp) => within(panel).getByText(label).closest(".fld") as HTMLElement;
    expect(row(/Open files \(all stages\)/i).textContent).toContain("14");
    expect(row(/Oldest open file \(days\)/i).textContent).toContain("42");
    expect(row(/Vehicles in use/i).textContent).toContain("3");
    // The tiles keep the figures the panel no longer repeats.
    const tileLabels = screen.getAllByText(/^(Active Files|SLA Breached|DAK Pending)$/);
    expect(tileLabels).toHaveLength(3);
  });

  it("shows dashes, not zeros, in the snapshot when the dashboard failed to load", async () => {
    getEstabDashboard.mockResolvedValue({ data: { ...DASH, openFiles: 0, oldestPendencyDays: 0 }, source: "error" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });
    render(await EstabDashboardPage());
    const panel = screen.getByRole("heading", { name: /Pendency snapshot/i }).closest(".card") as HTMLElement;
    expect(within(panel).getAllByText("—")).toHaveLength(3);
  });
});

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-02 (label matches field)", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("GAP-ESTAB-DASHBOARD-02: the service counts status='active', so the tile is 'Active Files' (what the register's tile counts), not 'Files Pending'", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });
    const ui = await EstabDashboardPage();
    render(ui);
    expect(screen.getByText("Active Files")).toBeInTheDocument();
    expect(screen.queryByText("Files Pending")).not.toBeInTheDocument();
    const tile = screen.getByText("Active Files").closest("a") as HTMLElement;
    expect(tile.textContent).toContain("12");
    expect(tile).toHaveAttribute("href", "/estab/list");
    // GAP-ESTAB-DASHBOARD-05 removed the snapshot's verbatim copy of this tile: "Active Files"
    // now lives in exactly one place, so the name and the number cannot drift apart.
    const snapshot = screen.getByRole("heading", { name: /Pendency snapshot/i }).closest(".card") as HTMLElement;
    expect(within(snapshot).queryByText(/Active files/i)).not.toBeInTheDocument();
    expect(screen.getAllByText("Active Files")).toHaveLength(1);
  });
});

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-03 (avg pendency formatting)", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("rounds a fractional avg pendency to one decimal, not the raw float", async () => {
    getEstabDashboard.mockResolvedValue({ data: { ...DASH, avgPendencyDays: 6.428571 }, source: "api" });
    getEstabFiles.mockResolvedValue({ data: [], source: "api" });
    const ui = await EstabDashboardPage();
    render(ui);
    expect(screen.getByText("6.4")).toBeInTheDocument();
    expect(screen.queryByText("6.428571")).not.toBeInTheDocument();
  });
});

describe("EstabDashboardPage — GAP-ESTAB-DASHBOARD-04 (recent files sorted)", () => {
  beforeEach(() => {
    getEstabDashboard.mockReset();
    getEstabFiles.mockReset();
  });

  it("lists recent files newest-first by createdDate regardless of API order", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({
      data: [
        { id: "f1", fileNo: "F/OLD", subject: "Old file", status: "active", createdDate: "2026-01-01", dueDate: "2026-02-01", classification: "unclassified", createdBy: "u1", tags: [] },
        { id: "f2", fileNo: "F/NEW", subject: "New file", status: "active", createdDate: "2026-09-01", dueDate: "2026-10-01", classification: "unclassified", createdBy: "u1", tags: [] },
      ],
      source: "api",
    });
    const ui = await EstabDashboardPage();
    render(ui);
    const bodyText = document.body.textContent ?? "";
    expect(bodyText.indexOf("F/NEW")).toBeLessThan(bodyText.indexOf("F/OLD"));
  });

  it("shows only the 8 newest of more files than that, newest first, whatever order the API returned", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    // 10 files, days 01..10 of September, delivered in a scrambled order.
    const order = [4, 9, 1, 10, 6, 2, 8, 3, 7, 5];
    getEstabFiles.mockResolvedValue({
      data: order.map((n) => fileRow(n, `2026-09-${String(n).padStart(2, "0")}`)),
      source: "api",
    });
    render(await EstabDashboardPage());
    expect(recentFileNos()).toEqual(["F/010", "F/009", "F/008", "F/007", "F/006", "F/005", "F/004", "F/003"]);
    expect(document.body.textContent).not.toContain("F/001");
    expect(document.body.textContent).not.toContain("F/002");
  });

  it("puts a file with no usable created date (the mapper's dash, or an unparseable value) after every dated file", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({
      data: [
        fileRow(1, "—"),
        fileRow(2, "2026-01-05"),
        fileRow(3, "not-a-date"),
        fileRow(4, "2026-03-05"),
      ],
      source: "api",
    });
    render(await EstabDashboardPage());
    const nos = recentFileNos();
    expect(nos.slice(0, 2)).toEqual(["F/004", "F/002"]);
    expect(new Set(nos.slice(2))).toEqual(new Set(["F/001", "F/003"]));
  });

  it("keeps the API's order among files created on the same day (the service sends newest first)", async () => {
    getEstabDashboard.mockResolvedValue({ data: DASH, source: "api" });
    getEstabFiles.mockResolvedValue({
      data: [fileRow(3, "2026-09-01"), fileRow(1, "2026-09-01"), fileRow(2, "2026-09-01")],
      source: "api",
    });
    render(await EstabDashboardPage());
    expect(recentFileNos()).toEqual(["F/003", "F/001", "F/002"]);
  });
});
